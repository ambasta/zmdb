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

const schema = `jobs_consumer_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`SET search_path TO ${schema}`);
  for (const migration of jobs.jobsPostgresMigrations) await pool.query(migration.up);
  const store = jobs.createPgJobStore(pool, { prepared: true, maxCacheSize: 8 });
  const now = new Date();
  await store.enqueue({ id: 'installed', name: 'deliver', payload: '{"id":42}', enqueuedAt: now, availableAt: now });
  const claimed = await store.claim({
    ids: ['installed'],
    holder: 'consumer',
    now,
    leaseUntil: new Date(now.getTime() + 1000),
  });
  if (claimed.length !== 1 || claimed[0].payload !== '{"id":42}') {
    throw new Error('@zmdb/jobs-postgres failed its installed domain claim');
  }
  await store.settle({
    kind: 'done',
    jobId: 'installed',
    holder: 'consumer',
    idempotencyKey: 'installed',
    completedAt: now,
  });
  if (!(await store.completed('installed'))) throw new Error('@zmdb/jobs-postgres omitted its completion marker');
  await store.close();
  const caller = await pool.query('SELECT 7::int AS answer');
  if (caller.rows[0]?.answer !== 7) {
    throw new Error('@zmdb/jobs-postgres took ownership of the installed consumer pool');
  }
  console.log('@zmdb/jobs-postgres packed consumer: live domain ports and caller-owned pool executed');
} finally {
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
}
