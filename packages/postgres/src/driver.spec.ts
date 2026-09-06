import { createRequire } from 'node:module';

import { createQueryCompiler, distance } from '@zmdb/query-compiler';
import type { Ext, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it, vi } from 'vitest';

import { postgresDriver, type PgQueryable } from './index.js';

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

describe('postgresDriver', () => {
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
    const driver = postgresDriver({ query } as unknown as PgQueryable);

    await expect(driver.execute({ text: 'SELECT 1', parameters: [10] })).resolves.toEqual([{ id: 1 }]);
    expect(query).toHaveBeenCalledWith('SELECT 1', [10]);
  });

  it('omits stream when the queryable cannot check out a connection', () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(postgresDriver({ query } as unknown as PgQueryable).stream).toBeUndefined();
  });

  it('hands a Date and a bigint over untouched', async () => {
    const query = vi.fn(async (_text: string, _params?: readonly unknown[]) => ({ rows: [] }));
    const driver = postgresDriver({ query } as unknown as PgQueryable);
    const at = new Date('2026-01-01T12:30:00.000Z');

    await driver.execute({ text: 'INSERT INTO events (at, seq) VALUES ($1, $2)', parameters: [at, 7n] });

    expect(query).toHaveBeenCalledWith('INSERT INTO events (at, seq) VALUES ($1, $2)', [at, 7n]);
  });

  it('runs as prepared statement when prepared: true is passed', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const driver = postgresDriver({ query } as unknown as PgQueryable, { prepared: true });

    await expect(driver.execute({ text: 'SELECT 1', parameters: [10] })).resolves.toEqual([{ id: 1 }]);
    expect(query).toHaveBeenCalledWith({
      name: expect.any(String),
      text: 'SELECT 1',
      values: [10],
    });
  });

  it('prepared:true passes a stable statement name', async () => {
    const configs: { name?: string; text: string }[] = [];
    const query = vi.fn(async (config: { name?: string; text: string }) => {
      configs.push(config);
      return { rows: [] };
    });
    const driver = postgresDriver({ query } as unknown as PgQueryable, { prepared: true });

    await driver.execute({ text: 'SELECT $1', parameters: [1] });
    await driver.execute({ text: 'SELECT $1', parameters: [2] });

    expect(configs).toHaveLength(2);
    expect(typeof configs[0]?.name).toBe('string');
    expect(configs[0]?.name).toBe(configs[1]?.name);
  });

  it('uses unnamed extended execution when the prepared-statement cache is disabled', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const driver = postgresDriver({ query } as unknown as PgQueryable, { prepared: true, maxCacheSize: 0 });

    await driver.execute({ text: 'SELECT $1', parameters: [1] });
    await driver.execute({ text: 'SELECT 1', parameters: [] });

    expect(query).toHaveBeenNthCalledWith(1, {
      queryMode: 'extended',
      text: 'SELECT $1',
      values: [1],
    });
    expect(query).toHaveBeenNthCalledWith(2, {
      queryMode: 'extended',
      text: 'SELECT 1',
      values: [],
    });
  });

  it('awaits DEALLOCATE when the prepared-statement LRU evicts an entry', async () => {
    const calls: unknown[] = [];
    const query = vi.fn(async (argument: unknown) => {
      calls.push(argument);
      return { rows: [] };
    });
    const driver = postgresDriver({ query } as unknown as PgQueryable, { prepared: true, maxCacheSize: 2 });

    await driver.execute({ text: 'SELECT 1', parameters: [] });
    await driver.execute({ text: 'SELECT 2', parameters: [] });
    const firstName = Reflect.get(calls[0] ?? {}, 'name');
    const secondName = Reflect.get(calls[1] ?? {}, 'name');
    await driver.execute({ text: 'SELECT 1', parameters: [] });
    await driver.execute({ text: 'SELECT 3', parameters: [] });

    expect(calls).toContain(`DEALLOCATE ${String(secondName)}`);
    await driver.execute({ text: 'SELECT 1', parameters: [] });
    expect(Reflect.get(calls.at(-1) ?? {}, 'name')).toBe(firstName);
    await driver.execute({ text: 'SELECT 2', parameters: [] });
    expect(Reflect.get(calls.at(-1) ?? {}, 'name')).not.toBe(secondName);
  });

  it('pins a pool transaction and releases it after rollback', async () => {
    const calls: string[] = [];
    const release = vi.fn();
    const client = {
      release,
      async query(argument: string | { readonly text: string }) {
        calls.push(typeof argument === 'string' ? argument : argument.text);
        return { rows: [] };
      },
    };
    const rootQuery = vi.fn(async () => ({ rows: [] }));
    const connect = vi.fn(async () => client);
    const pool = { totalCount: 1, idleCount: 1, connect, query: rootQuery };

    await expect(
      postgresDriver(pool).transaction(async transaction => {
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
      async query(argument: string | { readonly text: string; readonly values?: readonly unknown[] }) {
        calls.push(argument);
        const text = typeof argument === 'string' ? argument : argument.text;
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
    const pool = { totalCount: 1, idleCount: 1, connect, query: rootQuery };
    const stream = postgresDriver(pool as unknown as PgQueryable).stream;
    if (stream === undefined) throw new Error('postgresDriver did not expose stream for a pool');

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
      async query(argument: string | { readonly text: string; readonly values?: readonly unknown[] }) {
        calls.push(argument);
        const text = typeof argument === 'string' ? argument : argument.text;
        if (text === 'SELECT pg_backend_pid() AS pid') return { rows: [{ pid: 42 }] };
        if (text.startsWith('FETCH FORWARD')) return { rows: fetches++ === 0 ? [{ id: 7 }] : [] };
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
    const driver = postgresDriver(pool as unknown as PgQueryable);

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
