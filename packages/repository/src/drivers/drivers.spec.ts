import { createRequire } from 'node:module';

import { createQueryCompiler, distance } from '@zmdb/query-compiler';
import type { Ext, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, vi } from 'vitest';

import { pgDriver, type PgQueryable } from './pg.js';

interface PgVectorItem extends Table<'pgvector_items'> {
  readonly embedding: readonly number[] & Ext<'vector', 'vector', [3]>;
}

const requireFromHere = createRequire(import.meta.url);
const pgUtils: object = requireFromHere('pg/lib/utils');

function preparePgValue(value: unknown): unknown {
  const prepareValue: unknown = Reflect.get(pgUtils, 'prepareValue');
  if (typeof prepareValue !== 'function') throw new TypeError('node-postgres did not expose prepareValue');
  return Reflect.apply(prepareValue, pgUtils, [value]);
}

describe('pgDriver (#211)', () => {
  it('serializes a compiler-bound pgvector parameter through the real node-postgres path', () => {
    const vector = [0.1, 0.2, 0.3] as const;
    const query = createQueryCompiler('postgres')
      .selectFrom('pgvector_items')
      .orderBy(distance<PgVectorItem>('embedding', 'cosine', vector), 'asc')
      .compile();

    expect(preparePgValue(vector)).toBe('{"0.1","0.2","0.3"}');
    expect(query.parameters).toEqual(['[0.1,0.2,0.3]']);
    expect(preparePgValue(query.parameters[0])).toBe('[0.1,0.2,0.3]');
  });

  it('calls query(text, params) and returns rows by default (prepared: false)', async () => {
    const query = vi.fn(async (_text: string, _params?: readonly unknown[]) => ({ rows: [{ id: 1 }] }));
    const d = pgDriver({ query } as unknown as PgQueryable);
    const out = await d.execute({ text: 'SELECT 1', parameters: [10] });

    expect(query).toHaveBeenCalledWith('SELECT 1', [10]);
    expect(out).toEqual([{ id: 1 }]);
  });

  it('omits stream when the queryable cannot check out a connection', () => {
    const query = vi.fn(async () => ({ rows: [] }));

    expect(pgDriver({ query } as unknown as PgQueryable).stream).toBeUndefined();
  });

  it('hands a Date and a bigint over untouched', async () => {
    // The sqlite adapter converts a `Date` because `node:sqlite` throws on one. `pg` needs
    // no such help: it binds a `Date` as a timestamp itself and stringifies a `bigint`, so
    // converting here would be a second, differently-wrong answer to the same question.
    const query = vi.fn(async (_text: string, _params?: readonly unknown[]) => ({ rows: [] }));
    const d = pgDriver({ query } as unknown as PgQueryable);
    const at = new Date('2026-01-01T12:30:00.000Z');
    await d.execute({ text: 'INSERT INTO events (at, seq) VALUES ($1, $2)', parameters: [at, 7n] });

    expect(query).toHaveBeenCalledWith('INSERT INTO events (at, seq) VALUES ($1, $2)', [at, 7n]);
  });

  it('runs as prepared statement when prepared: true is passed', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const d = pgDriver({ query } as unknown as PgQueryable, { prepared: true });
    const out = await d.execute({ text: 'SELECT 1', parameters: [10] });

    expect(query).toHaveBeenCalledWith({
      name: expect.any(String),
      text: 'SELECT 1',
      values: [10],
    });
    expect(out).toEqual([{ id: 1 }]);
  });

  it('prepared:true passes a stable statement name', async () => {
    // The configs are captured here rather than read back off `query.mock.calls`:
    // `vi.fn(async () => …)` infers a zero-parameter mock, so `calls[0][0]` is an
    // out-of-bounds read on an empty tuple that only a cast could silence.
    const configs: { name?: string; text: string }[] = [];
    const query = vi.fn(async (config: { name?: string; text: string }) => {
      configs.push(config);
      return { rows: [] };
    });
    const d = pgDriver({ query } as unknown as PgQueryable, { prepared: true });
    await d.execute({ text: 'SELECT $1', parameters: [1] });
    await d.execute({ text: 'SELECT $1', parameters: [2] });
    expect(configs).toHaveLength(2);
    const [c0, c1] = configs;
    expect(typeof c0?.name).toBe('string');
    expect(c0?.name).toBe(c1?.name); // same SQL → same statement name
  });

  it('evicts oldest statement name and issues DEALLOCATE on server when maxCacheSize is exceeded (LRU)', async () => {
    const calls: unknown[] = [];
    const query = vi.fn(async (arg: unknown) => {
      calls.push(arg);
      return { rows: [] };
    });
    const d = pgDriver({ query } as unknown as PgQueryable, { prepared: true, maxCacheSize: 2 });

    await d.execute({ text: 'SELECT 1', parameters: [] }); // name 1
    await d.execute({ text: 'SELECT 2', parameters: [] }); // name 2
    const name1_orig = (calls[0] as { name?: string }).name;
    const name2_orig = (calls[1] as { name?: string }).name;

    // Access SELECT 1 to refresh LRU order
    await d.execute({ text: 'SELECT 1', parameters: [] });

    // Execute SELECT 3 -> evicts SELECT 2 and issues DEALLOCATE <name2_orig>
    await d.execute({ text: 'SELECT 3', parameters: [] });

    expect(calls).toContain(`DEALLOCATE ${name2_orig}`);

    // Access SELECT 1 -> should keep name1_orig
    await d.execute({ text: 'SELECT 1', parameters: [] });
    const name1_recheck = (calls[calls.length - 1] as { name?: string }).name;
    expect(name1_recheck).toBe(name1_orig);

    // Access SELECT 2 -> was evicted, so gets a new name
    await d.execute({ text: 'SELECT 2', parameters: [] });
    const name2_new = (calls[calls.length - 1] as { name?: string }).name;
    expect(name2_new).not.toBe(name2_orig);
  });

  it('pins a pool transaction to one acquired client and releases it after rollback', async () => {
    const calls: string[] = [];
    const release = vi.fn();
    const client = {
      release,
      async query(arg: string | { text: string }) {
        calls.push(typeof arg === 'string' ? arg : arg.text);
        return { rows: [] };
      },
    };
    const rootQuery = vi.fn(async () => ({ rows: [] }));
    const connect = vi.fn(async () => client);
    const pool = {
      totalCount: 1,
      idleCount: 1,
      connect,
      query: rootQuery,
    };
    const driver = pgDriver(pool);

    await expect(
      driver.transaction(async transaction => {
        await transaction.execute({ text: 'CREATE TABLE probe (id INTEGER)', parameters: [] });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');

    expect(calls).toEqual(['BEGIN', 'CREATE TABLE probe (id INTEGER)', 'ROLLBACK']);
    expect(rootQuery).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('fetches a pool cursor in batches and closes it when the consumer breaks', async () => {
    const calls: unknown[] = [];
    const release = vi.fn();
    let fetches = 0;
    const client = {
      release,
      async query(arg: string | { text: string; values?: readonly unknown[] }) {
        calls.push(arg);
        const text = typeof arg === 'string' ? arg : arg.text;
        if (text === 'SELECT pg_backend_pid() AS pid') return { rows: [{ pid: 41 }] };
        if (text.startsWith('FETCH FORWARD')) {
          fetches++;
          return { rows: [{ id: 1 }, { id: 2 }] };
        }
        return { rows: [] };
      },
    };
    const rootQuery = vi.fn(async () => ({ rows: [] }));
    const connect = vi.fn(async () => client);
    const pool = {
      totalCount: 1,
      idleCount: 1,
      connect,
      query: rootQuery,
    };
    const driver = pgDriver(pool as unknown as PgQueryable);
    const stream = driver.stream;
    if (stream === undefined) throw new Error('pgDriver did not expose stream for a pool');

    const rows: Record<string, unknown>[] = [];
    for await (const row of stream(
      { text: 'SELECT id FROM users WHERE role = $1', parameters: ['admin'] },
      { batchSize: 2 },
    )) {
      rows.push(row);
      break;
    }

    expect(rows).toEqual([{ id: 1 }]);
    expect(fetches).toBe(1);
    expect(calls).toEqual([
      'SELECT pg_backend_pid() AS pid',
      'BEGIN',
      {
        text: 'DECLARE "zmdb_0" NO SCROLL CURSOR FOR SELECT id FROM users WHERE role = $1',
        values: ['admin'],
      },
      'FETCH FORWARD 2 FROM "zmdb_0"',
      'CLOSE "zmdb_0"',
      'COMMIT',
    ]);
    expect(rootQuery).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('uses the transaction connection for a cursor without a nested transaction', async () => {
    const calls: unknown[] = [];
    const release = vi.fn();
    let fetches = 0;
    const client = {
      release,
      async query(arg: string | { text: string; values?: readonly unknown[] }) {
        calls.push(arg);
        const text = typeof arg === 'string' ? arg : arg.text;
        if (text === 'SELECT pg_backend_pid() AS pid') return { rows: [{ pid: 42 }] };
        if (text.startsWith('FETCH FORWARD')) {
          return { rows: fetches++ === 0 ? [{ id: 7 }] : [] };
        }
        return { rows: [] };
      },
    };
    const connect = vi.fn(async () => client);
    const pool = {
      totalCount: 1,
      idleCount: 1,
      connect,
      query: vi.fn(async () => ({ rows: [] })),
    };
    const driver = pgDriver(pool as unknown as PgQueryable);

    const rows = await driver.transaction(async transaction => {
      const stream = transaction.stream;
      if (stream === undefined) throw new Error('transaction driver did not expose stream');
      const result: Record<string, unknown>[] = [];
      for await (const row of stream({ text: 'SELECT id FROM users', parameters: [] }, { batchSize: 4 })) {
        result.push(row);
      }
      return result;
    });

    expect(rows).toEqual([{ id: 7 }]);
    expect(calls).toEqual([
      'BEGIN',
      'SELECT pg_backend_pid() AS pid',
      {
        text: 'DECLARE "zmdb_0" NO SCROLL CURSOR FOR SELECT id FROM users',
        values: [],
      },
      'FETCH FORWARD 4 FROM "zmdb_0"',
      'FETCH FORWARD 4 FROM "zmdb_0"',
      'CLOSE "zmdb_0"',
      'COMMIT',
    ]);
    expect(connect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
