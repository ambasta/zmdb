// The "real Postgres or skip" fixture the e2e specs share.
//
// Three of them (join, aggregate, fts) each carried their own copy of the same
// connect-seed-remember dance, down to the `pool!` non-null assertions in every
// test body. The point of those specs is that the compiled SQL survives a real
// server, not the connecting, so the connecting lives here.
//
// A checkout with no database has to keep passing the suite, so an unreachable
// server is not a failure: `reachable()` goes false and each spec returns early.
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';

import { pgDriver } from './drivers/pg.js';
import type { Driver } from './index.js';

/** Where the e2e specs look for Postgres: `ZMDB_PG`, else the benchmark container. */
export const PG_CONN = process.env.ZMDB_PG || 'postgres://postgres:postgres@localhost:55432/bench';

export interface PostgresFixture {
  /** False when the server could not be reached or `seed` threw — check this first and return. */
  reachable(): boolean;
  /** The shipped `pgDriver` over the fixture's pool — so these specs exercise the adapter users get. Throws if the server was unreachable. */
  driver(): Driver;
  /** The fixture's pool, for raw assertions. Throws if the server was unreachable. */
  pool(): Pool;
}

/**
 * Register `beforeAll`/`afterAll` that connect, run `seed` (create and populate
 * whatever tables the spec needs), and close the pool afterwards.
 */
export function usePostgres(seed: (pool: Pool) => Promise<void>): PostgresFixture {
  let pool: Pool | undefined;
  let reachable = false;

  beforeAll(async () => {
    try {
      pool = new Pool({ connectionString: PG_CONN, max: 2 });
      await pool.query('SELECT 1');
      await seed(pool);
      reachable = true;
    } catch {
      reachable = false;
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  const required = (): Pool => {
    if (!pool || !reachable) throw new Error(`Postgres not reachable at ${PG_CONN}`);
    return pool;
  };
  return {
    reachable: () => reachable,
    pool: required,
    driver: () => pgDriver(required()),
  };
}
