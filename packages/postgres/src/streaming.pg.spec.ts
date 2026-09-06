import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { postgresDriver } from './index.js';
import { usePostgres } from './testing/fixture.js';

const pg = usePostgres(async () => {});

describe('postgresDriver streaming and cancellation (#462)', () => {
  it('streams parameterised rows through a real PostgreSQL cursor', async () => {
    if (!pg.reachable()) return;
    const driver = postgresDriver(pg.pool());
    const stream = driver.stream;
    if (stream === undefined) throw new Error('postgresDriver did not expose stream for a pool');

    const rows: Record<string, unknown>[] = [];
    for await (const row of stream(
      {
        text: 'SELECT i FROM generate_series($1::int, $2::int) AS i ORDER BY i',
        parameters: [3, 8],
      },
      { batchSize: 2 },
    )) {
      rows.push(row);
    }

    expect(rows).toEqual([{ i: 3 }, { i: 4 }, { i: 5 }, { i: 6 }, { i: 7 }, { i: 8 }]);
  });

  it('releases the connection when an iterator is abandoned', async () => {
    if (!pg.reachable()) return;
    const pool = pg.pool();
    const driver = postgresDriver(pool);
    const stream = driver.stream;
    if (stream === undefined) throw new Error('postgresDriver did not expose stream for a pool');

    for (let index = 0; index < 20; index++) {
      for await (const _row of stream(
        {
          text: 'SELECT i FROM generate_series(1, 10) AS i',
          parameters: [],
        },
        { batchSize: 3 },
      )) {
        break;
      }
    }

    await expect(pool.query('SELECT 1 AS ready')).resolves.toMatchObject({ rows: [{ ready: 1 }] });
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });

  it('cancels the server-side query on abort', async () => {
    if (!pg.reachable()) return;
    const pool = pg.pool();
    const driver = postgresDriver(pool, { cancelVia: pool });
    const controller = new AbortController();
    const reason = new Error('request deadline reached');
    const startedAt = performance.now();
    const pending = driver.execute({ text: 'SELECT pg_sleep(10)', parameters: [] }, { signal: controller.signal });
    const timer = setTimeout(() => controller.abort(reason), 100);

    try {
      await expect(pending).rejects.toBe(reason);
    } finally {
      clearTimeout(timer);
    }

    expect(performance.now() - startedAt).toBeLessThan(3_000);
    await expect(pool.query('SELECT 1 AS ready')).resolves.toMatchObject({ rows: [{ ready: 1 }] });
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});
