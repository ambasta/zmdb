import { readFileSync } from 'node:fs';

import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { createMemoryJobStore } from './memory.js';
import { createPgJobStore } from './pg.js';

const PG_CONN = process.env.ZMDB_PG || 'postgres://postgres:postgres@localhost:55432/bench';

describe('queue backends (#588)', () => {
  it('ships an in-memory backend with the queue schema and claim index', () => {
    using store = createMemoryJobStore();

    const objects = store.database
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE name IN ('zmdb_job', 'zmdb_job_done', 'zmdb_job_pending')
         ORDER BY name`,
      )
      .all();

    expect(store.dialect).toBe('sqlite');
    expect(objects).toEqual([
      { name: 'zmdb_job', type: 'table' },
      { name: 'zmdb_job_done', type: 'table' },
      { name: 'zmdb_job_pending', type: 'index' },
    ]);
  });

  it('round-trips through a real pg Pool without taking ownership of it', async () => {
    const pool = new Pool({ connectionString: PG_CONN, connectionTimeoutMillis: 250, max: 1 });
    try {
      await pool.query('SELECT 1');
    } catch {
      await pool.end();
      console.warn(`[skip] Postgres not reachable at ${PG_CONN}`);
      return;
    }

    try {
      const store = createPgJobStore(pool);

      expect(store.dialect).toBe('postgres');
      await expect(store.execute({ text: 'SELECT $1::int AS answer', parameters: [42] })).resolves.toEqual([
        { answer: 42 },
      ]);
      await expect(pool.query('SELECT 2::int AS answer')).resolves.toMatchObject({ rows: [{ answer: 2 }] });
    } finally {
      await pool.end();
    }
  });

  it('keeps pg on an adapter-only optional peer boundary', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;

    expect(manifest).toMatchObject({
      exports: {
        './queues': './src/queues/index.ts',
        './queues/backends/pg': './src/queues/backends/pg.ts',
      },
      peerDependencies: { pg: '^8.23.0' },
      peerDependenciesMeta: { pg: { optional: true } },
    });
    expect(manifest['dependencies']).not.toMatchObject({ pg: expect.anything() });
  });
});
