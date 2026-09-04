import type { CompiledQuery } from '@zmdb/query-compiler';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { BaseRepository, defineRepository, type Driver } from '../index.js';
import { createTransactionalDb, type TxConnection } from '../transactions/index.js';

// Tests freeze for #460, against repository/SPEC.md §1a.
//
// `BaseRepository.stream`, ExecuteOptions and the transaction-aware stream surface do
// not exist yet. The two boundary helpers below call the real repository methods by
// name and widen only the arguments/results frozen in the spec. They do not supply a
// stream implementation: every stream assertion fails today with
// `TypeError: BaseRepository.stream is not a function`.

interface FrozenExecuteOptions {
  readonly signal?: AbortSignal;
  readonly batchSize?: number;
}

interface FrozenStreamOptions extends FrozenExecuteOptions {
  readonly requireCursor?: boolean;
}

type FrozenStream<Row> = AsyncIterable<Row> & AsyncDisposable;

function repositoryStream<Row>(
  repository: object,
  where?: Readonly<Record<string, unknown>>,
  options?: FrozenStreamOptions,
): FrozenStream<Row> {
  const method: unknown = Reflect.get(repository, 'stream');
  if (typeof method !== 'function') {
    throw new TypeError('BaseRepository.stream is not a function');
  }
  return Reflect.apply(method, repository, [where, options]) as FrozenStream<Row>;
}

function findAllWithSignal<Row>(
  repository: object,
  options: Readonly<{ signal: AbortSignal }>,
): Promise<readonly Row[]> {
  const method: unknown = Reflect.get(repository, 'findAll');
  if (typeof method !== 'function') {
    throw new TypeError('BaseRepository.findAll is not a function');
  }
  return Reflect.apply(method, repository, [options]) as Promise<readonly Row[]>;
}

export interface StreamRecord extends Table<'stream_records'> {
  id: number & Sql<'integer'> & PrimaryKey;
  payload: string & Sql<'text'>;
  at: Date & Sql<'timestamp'>;
  seq: bigint & Sql<'bigint'>;
}

function column(name: string, sql: ColumnIR['sql'], overrides: Partial<ColumnIR> = {}): ColumnIR {
  return {
    name,
    physicalName: name,
    sql,
    nullable: false,
    primaryKey: false,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    ...overrides,
  };
}

const STREAM_RECORD_IR: SchemaIR = {
  table: 'stream_records',
  physicalTable: 'stream_records',
  columns: [
    column('id', 'integer', { primaryKey: true }),
    column('payload', 'text'),
    column('at', 'timestamp'),
    column('seq', 'bigint'),
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

const StreamRecordSchema = schemaFromIR(STREAM_RECORD_IR);

class StreamRecords extends BaseRepository<StreamRecord> {
  static override readonly schema = StreamRecordSchema;
}

interface RowSource {
  readonly length: number;
  row(index: number): Record<string, unknown>;
}

function sourceFromRows(rows: readonly Record<string, unknown>[]): RowSource {
  return {
    length: rows.length,
    row(index) {
      const row = rows[index];
      if (row === undefined) throw new RangeError(`row ${index} is outside the recording source`);
      return row;
    },
  };
}

type RecordingEvent =
  | { readonly kind: 'execute'; readonly options: FrozenExecuteOptions | undefined }
  | { readonly kind: 'fetch'; readonly size: number }
  | { readonly kind: 'return' };

/**
 * A cursor-shaped driver double rather than an async generator over an array.
 *
 * `execute` materialises the entire source in one round trip. `stream` creates only
 * the current batch, records every fetch, and records the iterator's `return()`.
 * That makes the tests distinguish all three common fakes: execute-and-yield,
 * consume-the-driver-stream-before-yielding, and omit cleanup on early exit.
 */
class RecordingStreamingDriver implements Driver {
  readonly events: RecordingEvent[] = [];

  constructor(private readonly source: RowSource) {}

  execute(_query: CompiledQuery, options?: FrozenExecuteOptions): Promise<readonly Record<string, unknown>[]> {
    this.events.push({ kind: 'execute', options });
    const rows: Record<string, unknown>[] = [];
    for (let index = 0; index < this.source.length; index++) rows.push(this.source.row(index));
    return Promise.resolve(rows);
  }

  stream(_query: CompiledQuery, options?: FrozenExecuteOptions): AsyncIterable<Record<string, unknown>> {
    const batchSize = options?.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new RangeError('batchSize must be a positive integer');
    }

    let started = false;
    return {
      [Symbol.asyncIterator]: () => {
        if (started) throw new Error('recording cursor is single-shot');
        started = true;

        let index = 0;
        let batch: Record<string, unknown>[] = [];
        let batchIndex = 0;
        let closed = false;

        const close = (): void => {
          if (closed) return;
          closed = true;
          batch = [];
          this.events.push({ kind: 'return' });
        };

        return {
          next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
            options?.signal?.throwIfAborted();
            if (closed) return { done: true, value: undefined };
            if (index >= this.source.length) {
              close();
              return { done: true, value: undefined };
            }

            if (batchIndex >= batch.length) {
              const end = Math.min(index + batchSize, this.source.length);
              batch = [];
              for (let rowIndex = index; rowIndex < end; rowIndex++) batch.push(this.source.row(rowIndex));
              batchIndex = 0;
              this.events.push({ kind: 'fetch', size: batch.length });
            }

            const value = batch[batchIndex];
            if (value === undefined) throw new Error('recording cursor produced an empty batch');
            batchIndex++;
            index++;
            return { done: false, value };
          },
          return: async (): Promise<IteratorResult<Record<string, unknown>>> => {
            close();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }
}

async function collect<Row>(iterable: AsyncIterable<Row>): Promise<readonly Row[]> {
  const rows: Row[] = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

function fetchSizes(driver: RecordingStreamingDriver): readonly number[] {
  return driver.events.flatMap(event => (event.kind === 'fetch' ? [event.size] : []));
}

function countEvents(driver: RecordingStreamingDriver, kind: RecordingEvent['kind']): number {
  return driver.events.filter(event => event.kind === kind).length;
}

const ISO = '2026-01-01T12:30:00.000Z';

function ordinaryRow(index: number): Record<string, unknown> {
  return {
    id: index + 1,
    payload: `row-${index + 1}`,
    at: ISO,
    seq: String(index + 1),
  };
}

describe('repository streaming and cancellation (frozen: repository/SPEC.md 1a)', () => {
  // Actual at c972d74b: BaseRepository has no `stream` method. The recording
  // driver would expose a fake that calls execute once: the assertions below
  // require ten cursor fetches and zero execute calls instead.
  it.fails('streams in batches rather than one round trip', async () => {
    const driver = new RecordingStreamingDriver({
      length: 1_000,
      row: ordinaryRow,
    });
    const records = new StreamRecords(driver);

    const rows = await collect(repositoryStream<StreamRecord>(records, undefined, { batchSize: 100 }));

    expect(rows).toHaveLength(1_000);
    expect(fetchSizes(driver)).toEqual(Array.from({ length: 10 }, () => 100));
    expect(countEvents(driver, 'execute')).toBe(0);
  });

  // Actual at c972d74b: BaseRepository has no `stream` method.
  //
  // The threshold is deliberately wide. The source is 4096 × 32 KiB (128 MiB)
  // while one batch is 1 MiB. A cursor may spend several MiB on compilation,
  // decoding and allocator slack; it may not materialise the other 127 batches
  // before delivering row one. The fetch-count assertion is deterministic and
  // the heap assertion catches the same defect in the resource users actually lose.
  it.fails('holds bounded memory over a result set larger than the batch size', async () => {
    const decoder = new TextDecoder();
    const driver = new RecordingStreamingDriver({
      length: 4_096,
      row(index) {
        const bytes = new Uint8Array(32 * 1_024);
        bytes.fill(65 + (index % 26));
        return {
          ...ordinaryRow(index),
          payload: `${index}:${decoder.decode(bytes)}`,
        };
      },
    });
    const records = new StreamRecords(driver);
    const before = process.memoryUsage().heapUsed;

    const iterator = repositoryStream<StreamRecord>(records, undefined, {
      batchSize: 32,
    })[Symbol.asyncIterator]();
    const first = await iterator.next();
    const heapDelta = process.memoryUsage().heapUsed - before;

    expect(first).toMatchObject({ done: false, value: { id: 1 } });
    expect(fetchSizes(driver)).toEqual([32]);
    expect(heapDelta).toBeLessThan(48 * 1_024 * 1_024);

    if (iterator.return) await iterator.return();
  }, 20_000);

  // Actual at c972d74b: BaseRepository has no `stream` method.
  // `for await` invokes the repository iterator's return on break; disposing the
  // already-closed stream must not double-return the driver's cursor.
  it.fails('closes the cursor when the consumer breaks early', async () => {
    const driver = new RecordingStreamingDriver({
      length: 10,
      row: ordinaryRow,
    });
    const records = new StreamRecords(driver);
    const rows = repositoryStream<StreamRecord>(records, undefined, { batchSize: 4 });

    for await (const row of rows) {
      expect(row.id).toBe(1);
      break;
    }
    await rows[Symbol.asyncDispose]();

    expect(fetchSizes(driver)).toEqual([4]);
    expect(countEvents(driver, 'return')).toBe(1);
    expect(countEvents(driver, 'execute')).toBe(0);
  });

  // The live issue calls this "validation", but repository/SPEC.md §1a and the
  // real `find` path are explicit: fetched rows are decoded, not schema-validated.
  // This keeps the load-bearing issue title while asserting the actual shared
  // boundary. Convertible timestamp/bigint values change; malformed values pass
  // through unchanged for a caller-side validator to reject.
  //
  // Actual at c972d74b: findAll returns the expected decoded rows, then the test
  // reaches the absent BaseRepository.stream method.
  it.fails('validates every streamed row with the same validator as find', async () => {
    const rawRows = [
      { id: 1, payload: 'valid', at: ISO, seq: '90071992547409910' },
      { id: 2, payload: 'malformed', at: 'nonsense', seq: '0x10' },
    ] as const;
    const driver = new RecordingStreamingDriver(sourceFromRows(rawRows));
    const records = new StreamRecords(driver);

    const found = await records.findAll();
    const streamed = await collect(repositoryStream<StreamRecord>(records, undefined, { batchSize: 1 }));

    expect(streamed).toEqual(found);
    expect(streamed[0]).toEqual({
      id: 1,
      payload: 'valid',
      at: new Date(ISO),
      seq: 90071992547409910n,
    });
    expect(streamed[1]).toEqual({
      id: 2,
      payload: 'malformed',
      at: 'nonsense',
      seq: '0x10',
    });
    expect(fetchSizes(driver)).toEqual([1, 1]);
  });

  // Actual at c972d74b: findAll ignores the options object and resolves after
  // the driver finishes. The frozen behaviour passes the same signal through
  // and rejects with its exact reason after the pending read settles.
  it.fails('rejects a pending read when its signal aborts', async () => {
    const gate = Promise.withResolvers<void>();
    let observed: FrozenExecuteOptions | undefined;
    const driver: Driver = {
      async execute(_query: CompiledQuery, options?: FrozenExecuteOptions) {
        observed = options;
        await gate.promise;
        options?.signal?.throwIfAborted();
        return [];
      },
    };
    const records = new StreamRecords(driver);
    const controller = new AbortController();
    const reason = new DOMException('consumer left', 'AbortError');

    const pending = findAllWithSignal<StreamRecord>(records, {
      signal: controller.signal,
    });
    controller.abort(reason);
    gate.resolve();

    await expect(pending).rejects.toBe(reason);
    expect(observed?.signal).toBe(controller.signal);
  });

  // Actual at c972d74b: the driver's second argument is undefined, so no abort
  // listener is installed and the query resolves when the test releases it.
  // A repository-side Promise.race is insufficient: only the driver's listener
  // records `cancel`, which stands for the out-of-band server cancellation.
  it.fails('asks the driver to cancel the server-side query on abort', async () => {
    const result = Promise.withResolvers<readonly Record<string, unknown>[]>();
    const events: string[] = [];
    let observedSignal: AbortSignal | undefined;
    const driver: Driver = {
      execute(_query: CompiledQuery, options?: FrozenExecuteOptions) {
        events.push('execute');
        observedSignal = options?.signal;
        options?.signal?.addEventListener(
          'abort',
          () => {
            events.push('cancel');
            result.reject(options.signal?.reason);
          },
          { once: true },
        );
        return result.promise;
      },
    };
    const records = new StreamRecords(driver);
    const controller = new AbortController();
    const reason = new DOMException('deadline', 'AbortError');

    const pending = findAllWithSignal<StreamRecord>(records, {
      signal: controller.signal,
    });
    controller.abort(reason);
    if (observedSignal === undefined) result.resolve([]);

    await expect(pending).rejects.toBe(reason);
    expect(observedSignal).toBe(controller.signal);
    expect(events).toEqual(['execute', 'cancel']);
  });

  // The issue's "warning" is the structured warning frozen in §1a:
  // onQuery receives `{ buffered: true }`; the library does not write to stderr.
  // Actual at c972d74b: defineRepository accepts the options object but ignores
  // onQuery, and BaseRepository has no stream method.
  it.fails('buffers with a warning when the driver has no stream method', async () => {
    class ExecuteOnlyDriver implements Driver {
      readonly calls: CompiledQuery[] = [];

      execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]> {
        this.calls.push(query);
        return Promise.resolve([{ id: 1, payload: 'buffered', at: ISO, seq: '7' }]);
      }
    }

    interface QueryMeta {
      readonly filters: readonly string[];
      readonly buffered?: boolean;
    }

    const driver = new ExecuteOnlyDriver();
    const observations: { readonly query: CompiledQuery; readonly meta: QueryMeta }[] = [];
    const records = Reflect.apply(defineRepository, undefined, [
      StreamRecordSchema,
      driver,
      {
        dialect: 'postgres',
        onQuery(query: CompiledQuery, meta: QueryMeta) {
          observations.push({ query, meta });
        },
      },
    ]) as StreamRecords;

    const rows = await collect(repositoryStream<StreamRecord>(records, undefined, { batchSize: 1 }));

    expect(rows).toEqual([{ id: 1, payload: 'buffered', at: new Date(ISO), seq: 7n }]);
    expect(driver.calls).toHaveLength(1);
    expect(observations).toEqual([
      {
        query: {
          text: 'SELECT * FROM "stream_records"',
          parameters: [],
        },
        meta: {
          filters: [],
          buffered: true,
        },
      },
    ]);

    await expect(
      collect(
        repositoryStream<StreamRecord>(records, undefined, {
          requireCursor: true,
        }),
      ),
    ).rejects.toThrow(/ExecuteOnlyDriver.*does not implement.*stream/i);
    expect(driver.calls).toHaveLength(1);
  });

  // Actual at c972d74b: createTransactionalDb does not expose a connection's
  // stream method and BaseRepository.withTransaction forwards execute only.
  // The log requires the cursor to close before COMMIT, then requires a later
  // next() to reject as a transaction-scope error rather than look like EOF.
  it.fails('refuses to stream outside the transaction that owns the connection', async () => {
    class StreamingConnection implements TxConnection {
      readonly log: string[] = [];

      raw(sql: string): Promise<void> {
        this.log.push(sql);
        return Promise.resolve();
      }

      execute(): Promise<readonly Record<string, unknown>[]> {
        return Promise.resolve([]);
      }

      stream(): AsyncIterable<Record<string, unknown>> {
        this.log.push('STREAM');
        let index = 0;
        let closed = false;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
              if (closed || index >= 2) return { done: true, value: undefined };
              index++;
              return { done: false, value: ordinaryRow(index - 1) };
            },
            return: async (): Promise<IteratorResult<Record<string, unknown>>> => {
              if (!closed) {
                closed = true;
                this.log.push('RETURN');
              }
              return { done: true, value: undefined };
            },
          }),
        };
      }
    }

    const connection = new StreamingConnection();
    const db = createTransactionalDb(connection);
    const parent = new StreamRecords({
      execute: () => Promise.resolve([]),
    });
    let heldIterator: AsyncIterator<StreamRecord> | undefined;

    await db.transaction(async transaction => {
      const scoped = Reflect.apply(parent.withTransaction, parent, [transaction]) as StreamRecords;
      const rows = repositoryStream<StreamRecord>(scoped);
      heldIterator = rows[Symbol.asyncIterator]();
      await expect(heldIterator.next()).resolves.toMatchObject({
        done: false,
        value: { id: 1 },
      });
    });

    expect(connection.log).toEqual(['BEGIN', 'STREAM', 'RETURN', 'COMMIT']);
    if (heldIterator === undefined) throw new Error('transaction did not return a stream iterator');
    await expect(heldIterator.next()).rejects.toThrow(/transaction/i);
    expect(connection.log.filter(entry => entry === 'RETURN')).toHaveLength(1);
  });
});
