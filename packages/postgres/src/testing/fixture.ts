import type { Driver } from '@zmdb/repository';
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';

import { postgresDriver } from '../index.js';

/** Where optional local E2E specs look for PostgreSQL. */
export const POSTGRES_CONNECTION =
  process.env['ZMDB_POSTGRES_URL'] ?? process.env['ZMDB_PG'] ?? 'postgres://postgres:postgres@localhost:55432/bench';
const REQUIRE_POSTGRES = process.env['ZMDB_REQUIRE_PG'] === '1';

export interface PostgresFixture {
  reachable(): boolean;
  driver(): Driver<'postgres'>;
  pool(): Pool;
}

/**
 * Register an optional local PostgreSQL fixture. Release qualification uses the
 * fail-closed packed consumer; these tests remain useful during development.
 */
export function usePostgres(seed: (pool: Pool) => Promise<void>): PostgresFixture {
  let pool: Pool | undefined;
  let reachable = false;

  beforeAll(async () => {
    try {
      pool = new Pool({ connectionString: POSTGRES_CONNECTION, max: 2 });
      await pool.query('SELECT 1');
      await seed(pool);
      reachable = true;
    } catch (error) {
      reachable = false;
      await pool?.end().catch(() => {});
      pool = undefined;
      if (REQUIRE_POSTGRES) throw error;
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  const required = (): Pool => {
    if (pool === undefined || !reachable) {
      throw new Error(`PostgreSQL not reachable at ${POSTGRES_CONNECTION}`);
    }
    return pool;
  };

  return {
    reachable: () => reachable,
    pool: required,
    driver: () => postgresDriver(required()),
  };
}
