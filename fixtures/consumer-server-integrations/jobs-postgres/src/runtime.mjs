import { Pool } from 'pg';

const jobs = await import('@zmdb/jobs-postgres');

if (typeof jobs.createPgJobStore !== 'function') {
  throw new Error('@zmdb/jobs-postgres omitted createPgJobStore');
}

const connectionString = process.env.ZMDB_PG ?? 'postgres://postgres:postgres@localhost:55432/bench';
const required = process.env.ZMDB_REQUIRE_PG === '1';
const pool = new Pool({ connectionString, connectionTimeoutMillis: 1000, max: 1 });

try {
  await pool.query('SELECT 1');
} catch (error) {
  await pool.end().catch(() => undefined);
  if (required) throw error;
  console.warn(`[skip] Postgres not reachable at ${connectionString}`);
  process.exit(0);
}

try {
  const store = jobs.createPgJobStore(pool, { prepared: true, maxCacheSize: 8 });
  const rows = await store.execute({ text: 'SELECT $1::int AS answer', parameters: [42] });
  if (store.dialect !== 'postgres' || rows[0]?.answer !== 42) {
    throw new Error('@zmdb/jobs-postgres failed its installed parameterized query');
  }
  const caller = await pool.query('SELECT 7::int AS answer');
  if (caller.rows[0]?.answer !== 7) {
    throw new Error('@zmdb/jobs-postgres took ownership of the installed consumer pool');
  }
} finally {
  await pool.end();
}
