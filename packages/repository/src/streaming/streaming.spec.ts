import type { CompiledQuery } from '@zmdb/query-compiler';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { BaseRepository, defineRepository, type Driver } from '../index.js';
import { officialDialects, type OfficialDialectName } from '../testing/official-dialects.fixture.js';
import { createTransactionalDb, type TxConnection } from '../transactions/index.js';

// Tests freeze for #460, retired by #461 against repository/SPEC.md §1a.
//
// The two boundary helpers remain intentionally literal: they exercise the
// public method names and the exact frozen options/result shapes without
// supplying any implementation of their own.

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
  readonly dialect = officialDialects.postgres;
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
  it('streams in batches rather than one round trip', async () => {
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

  it('compiles streamed predicates with all six SQL variants', async () => {
    const expected = {
      postgres: 'SELECT * FROM "stream_records" WHERE "id" = $1',
      mysql: 'SELECT * FROM `stream_records` WHERE `id` = ?',
      sqlite: 'SELECT * FROM "stream_records" WHERE "id" = ?',
      mssql: 'SELECT * FROM [stream_records] WHERE [id] = @p1',
      cockroach: 'SELECT * FROM "stream_records" WHERE "id" = $1',
      singlestore: 'SELECT * FROM `stream_records` WHERE `id` = ?',
    } satisfies Record<OfficialDialectName, string>;

    for (const dialect of Object.keys(expected) as OfficialDialectName[]) {
      let observedQuery: CompiledQuery | undefined;
      let observedOptions: FrozenExecuteOptions | undefined;
      const driver: Driver = {
        dialect: officialDialects[dialect],
        execute: () => Promise.resolve([]),
        stream(query, options) {
          observedQuery = query;
          observedOptions = options;
          return {
            async *[Symbol.asyncIterator]() {},
          };
        },
      };

      await collect(
        repositoryStream<StreamRecord>(
          new StreamRecords(driver, officialDialects[dialect]),
          { id: 7 },
          { batchSize: 17 },
        ),
      );

      expect(observedQuery).toEqual({
        text: expected[dialect],
        parameters: [7],
        operation: 'select',
        isWrite: false,
        returnsRows: true,
      });
      expect(observedOptions).toEqual({ batchSize: 17 });
    }
  });

  // The threshold is deliberately wide. The source is 4096 × 32 KiB (128 MiB)
  // while one batch is 1 MiB. A cursor may spend several MiB on compilation,
  // decoding and allocator slack; it may not materialise the other 127 batches
  // before delivering row one. The fetch-count assertion is deterministic and
  // the heap assertion catches the same defect in the resource users actually lose.
  it('holds bounded memory over a result set larger than the batch size', async () => {
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

  // `for await` invokes the repository iterator's return on break; disposing the
  // already-closed stream must not double-return the driver's cursor.
  it('closes the cursor when the consumer breaks early', async () => {
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

  it('disposes an unstarted stream without opening a cursor', async () => {
    let opens = 0;
    const driver: Driver = {
      dialect: officialDialects.postgres,
      execute: () => Promise.resolve([]),
      stream() {
        opens++;
        return {
          async *[Symbol.asyncIterator]() {
            yield ordinaryRow(0);
          },
        };
      },
    };
    const rows = repositoryStream<StreamRecord>(new StreamRecords(driver));

    await rows[Symbol.asyncDispose]();

    expect(opens).toBe(0);
    expect(() => rows[Symbol.asyncIterator]()).toThrow(/disposed/i);
  });

  it('cleans up through one path for break, throw and abort', async () => {
    const breakDriver = new RecordingStreamingDriver({ length: 3, row: ordinaryRow });
    for await (const _row of repositoryStream<StreamRecord>(new StreamRecords(breakDriver))) break;

    const throwDriver = new RecordingStreamingDriver({ length: 3, row: ordinaryRow });
    const consumerFailure = new Error('consumer failed');
    await expect(
      (async () => {
        for await (const _row of repositoryStream<StreamRecord>(new StreamRecords(throwDriver))) {
          throw consumerFailure;
        }
      })(),
    ).rejects.toBe(consumerFailure);

    const abortDriver = new RecordingStreamingDriver({ length: 3, row: ordinaryRow });
    const controller = new AbortController();
    const aborted = repositoryStream<StreamRecord>(new StreamRecords(abortDriver), undefined, {
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    await expect(aborted.next()).resolves.toMatchObject({ done: false, value: { id: 1 } });
    const abortReason = new DOMException('stop iteration', 'AbortError');
    controller.abort(abortReason);
    await expect(aborted.next()).rejects.toBe(abortReason);

    for (const driver of [breakDriver, throwDriver, abortDriver]) {
      expect(countEvents(driver, 'return')).toBe(1);
    }
  });

  // The live issue calls this "validation", but repository/SPEC.md §1a and the
  // real `find` path are explicit: fetched rows are decoded, not schema-validated.
  // This keeps the load-bearing issue title while asserting the actual shared
  // boundary. Convertible timestamp/bigint values change; malformed values pass
  // through unchanged for a caller-side validator to reject.
  //
  it('validates every streamed row with the same validator as find', async () => {
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

  it('resolves the streamed row decoder once before iterating', async () => {
    let irReads = 0;
    const CountingSchema = new Proxy(StreamRecordSchema, {
      get(target, property, receiver) {
        if (property === 'ir') irReads++;
        return Reflect.get(target, property, receiver);
      },
    });
    class CountingRecords extends BaseRepository<StreamRecord> {
      static override readonly schema = CountingSchema;
    }

    const records = new CountingRecords(
      new RecordingStreamingDriver({
        length: 128,
        row: ordinaryRow,
      }),
    );
    await collect(repositoryStream<StreamRecord>(records, undefined, { batchSize: 8 }));

    // One IR read resolves the inherited repository filters and one resolves
    // the row decoder. Iteration itself must not revisit either.
    expect(irReads).toBe(2);
  });

  // The repository passes the same signal through and rejects with its exact
  // reason after a driver without active cancellation eventually settles.
  it('rejects a pending read when its signal aborts', async () => {
    const gate = Promise.withResolvers<void>();
    let observed: FrozenExecuteOptions | undefined;
    const driver: Driver = {
      dialect: officialDialects.postgres,
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

  // A repository-side Promise.race is insufficient: only the driver's listener
  // records `cancel`, which stands for the out-of-band server cancellation.
  it('asks the driver to cancel the server-side query on abort', async () => {
    const result = Promise.withResolvers<readonly Record<string, unknown>[]>();
    const events: string[] = [];
    let observedSignal: AbortSignal | undefined;
    const driver: Driver = {
      dialect: officialDialects.postgres,
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
  it('buffers with a warning when the driver has no stream method', async () => {
    class ExecuteOnlyDriver implements Driver {
      readonly dialect = officialDialects.postgres;
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
        dialect: officialDialects.postgres,
        onQuery(query: CompiledQuery, meta: QueryMeta) {
          observations.push({ query, meta });
        },
      },
    ]) as StreamRecords;

    const rows = await collect(repositoryStream<StreamRecord>(records, undefined, { batchSize: 1 }));
    const repeated = await collect(repositoryStream<StreamRecord>(records, undefined, { batchSize: 1 }));

    expect(rows).toEqual([{ id: 1, payload: 'buffered', at: new Date(ISO), seq: 7n }]);
    expect(repeated).toEqual(rows);
    expect(driver.calls).toHaveLength(2);
    expect(observations).toEqual([
      {
        query: {
          text: 'SELECT * FROM "stream_records"',
          parameters: [],
          operation: 'select',
          isWrite: false,
          returnsRows: true,
        },
        meta: {
          filters: [],
          buffered: true,
        },
      },
      {
        query: {
          text: 'SELECT * FROM "stream_records"',
          parameters: [],
          operation: 'select',
          isWrite: false,
          returnsRows: true,
        },
        meta: {
          filters: [],
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
    expect(driver.calls).toHaveLength(2);
  });

  it('treats only a callable stream member as cursor capability', async () => {
    const driver: Driver = {
      dialect: officialDialects.postgres,
      execute: () => Promise.resolve([{ id: 1, payload: 'buffered', at: ISO, seq: '7' }]),
      // @ts-expect-error — JavaScript adapters can still expose malformed
      // capability metadata; the runtime check must not call a non-function.
      stream: null,
    };
    const records = new StreamRecords(driver);

    await expect(collect(repositoryStream<StreamRecord>(records))).resolves.toEqual([
      { id: 1, payload: 'buffered', at: new Date(ISO), seq: 7n },
    ]);
  });

  it('threads one AbortSignal through every repository read', async () => {
    const observed: (FrozenExecuteOptions | undefined)[] = [];
    const driver: Driver = {
      dialect: officialDialects.postgres,
      execute(_query, options) {
        observed.push(options);
        return Promise.resolve([]);
      },
      stream(_query, options) {
        observed.push(options);
        return {
          async *[Symbol.asyncIterator]() {},
        };
      },
    };
    const records = new StreamRecords(driver);
    const signal = new AbortController().signal;

    await records.findById(1, { signal });
    await records.findOne({}, { signal });
    await records.find({ id: 1 }, { signal });
    await records.findAll({ signal });
    await records.count(undefined, { signal });
    await records.exists(undefined, { signal });
    await records.list(undefined, { signal });
    await records.findByFullText('payload', 'row', { signal });
    await records.findJoined({ target: 'other_records', leftCol: 'id', rightCol: 'streamRecordId' }, undefined, {
      signal,
    });
    await records.aggregate(aggregate => aggregate.count('id', 'n'), { signal });
    await records.findAllWithMany('children', 'child_records', 'streamRecordId', 'id', { signal });
    await collect(repositoryStream<StreamRecord>(records, undefined, { signal }));

    expect(observed).toHaveLength(12);
    expect(observed.every(options => options?.signal === signal)).toBe(true);
  });

  it('rejects an already-aborted read with the platform AbortError before dispatch', async () => {
    let calls = 0;
    let compiled = 0;
    const driver: Driver = {
      dialect: officialDialects.postgres,
      execute() {
        calls++;
        return Promise.resolve([]);
      },
    };
    const records = Reflect.apply(defineRepository, undefined, [
      StreamRecordSchema,
      driver,
      {
        dialect: officialDialects.postgres,
        onQuery() {
          compiled++;
        },
      },
    ]) as StreamRecords;
    const controller = new AbortController();
    controller.abort();

    await expect(records.findAll({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(() => repositoryStream(records, undefined, { signal: controller.signal })).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
    expect(calls).toBe(0);
    expect(compiled).toBe(0);
  });

  // The log requires the cursor to close before COMMIT, then requires a later
  // next() to reject as a transaction-scope error rather than look like EOF.
  it('refuses to stream outside the transaction that owns the connection', async () => {
    class StreamingConnection implements TxConnection {
      readonly log: string[] = [];
      observedSignal: AbortSignal | undefined;

      raw(sql: string): Promise<void> {
        this.log.push(sql);
        return Promise.resolve();
      }

      execute(): Promise<readonly Record<string, unknown>[]> {
        return Promise.resolve([]);
      }

      stream(_query: CompiledQuery, options?: FrozenExecuteOptions): AsyncIterable<Record<string, unknown>> {
        this.log.push('STREAM');
        this.observedSignal = options?.signal;
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
      dialect: officialDialects.postgres,
      execute: () => Promise.resolve([]),
    });
    let heldIterator: AsyncIterator<StreamRecord> | undefined;
    const signal = new AbortController().signal;

    await db.transaction(async transaction => {
      const scoped = Reflect.apply(parent.withTransaction, parent, [transaction]) as StreamRecords;
      const rows = repositoryStream<StreamRecord>(scoped, undefined, { signal });
      heldIterator = rows[Symbol.asyncIterator]();
      await expect(heldIterator.next()).resolves.toMatchObject({
        done: false,
        value: { id: 1 },
      });
    });

    expect(connection.log).toEqual(['BEGIN', 'STREAM', 'RETURN', 'COMMIT']);
    expect(connection.observedSignal).toBe(signal);
    if (heldIterator === undefined) throw new Error('transaction did not return a stream iterator');
    await expect(heldIterator.next()).rejects.toThrow(/transaction/i);
    expect(connection.log.filter(entry => entry === 'RETURN')).toHaveLength(1);
  });

  it('closes every transaction stream before rollback when one cursor close fails', async () => {
    class FailingCloseConnection implements TxConnection {
      readonly log: string[] = [];
      #stream = 0;

      raw(sql: string): Promise<void> {
        this.log.push(sql);
        return Promise.resolve();
      }

      execute(): Promise<readonly Record<string, unknown>[]> {
        return Promise.resolve([]);
      }

      stream(): AsyncIterable<Record<string, unknown>> {
        const id = ++this.#stream;
        this.log.push(`STREAM ${id}`);
        let yielded = false;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
              if (yielded) return { done: true, value: undefined };
              yielded = true;
              return { done: false, value: ordinaryRow(id - 1) };
            },
            return: async (): Promise<IteratorResult<Record<string, unknown>>> => {
              this.log.push(`RETURN ${id}`);
              if (id === 1) throw new Error('first cursor close failed');
              return { done: true, value: undefined };
            },
          }),
        };
      }
    }

    const connection = new FailingCloseConnection();
    const db = createTransactionalDb(connection);

    await expect(
      db.transaction(async transaction => {
        const stream = transaction.stream;
        if (stream === undefined) throw new Error('connection should expose stream');
        const first = stream({ text: 'SELECT 1', parameters: [] })[Symbol.asyncIterator]();
        const second = stream({ text: 'SELECT 2', parameters: [] })[Symbol.asyncIterator]();
        await first.next();
        await second.next();
      }),
    ).rejects.toThrow('first cursor close failed');

    expect(connection.log).toEqual(['BEGIN', 'STREAM 1', 'STREAM 2', 'RETURN 1', 'RETURN 2', 'ROLLBACK']);
  });
});
