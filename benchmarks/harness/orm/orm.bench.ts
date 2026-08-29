// Honest ORM benchmark against REAL PostgreSQL, using the drizzle-benchmarks
// Northwind dataset (10k customers / 50k orders / 308k order-details) loaded
// into Postgres, and the upstream canonical query set.
//
// All three ORMs run against the SAME Postgres instance over the SAME `pg`
// pool/protocol, so the numbers isolate query-building + result-mapping
// overhead per ORM. Competitors: drizzle-orm (node-postgres), kysely
// (PostgresDialect), zmdb (@zmdb/query-compiler → pg).
import pg from 'pg';
import { Bench } from 'tinybench';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Kysely, PostgresDialect } from 'kysely';
import { createQueryCompiler } from '../../../packages/query-compiler/src/index.ts';

const CONN = 'postgres://postgres:postgres@localhost:55432/bench';
const pool = new pg.Pool({ connectionString: CONN, max: 4 });

// --- drizzle (node-postgres) ---
const ddb = drizzle(pool);

// --- kysely (real PostgresDialect over the same pool) ---
const k = new Kysely<Record<string, Record<string, unknown>>>({
  dialect: new PostgresDialect({ pool }),
});

// --- zmdb (query-compiler → pg pool) ---
const qc = createQueryCompiler('postgres');
const zexec = (text: string, params: unknown[]) => pool.query(text, params);

async function sanity() {
  const r = await pool.query('select count(*)::int n from customers');
  const d = await pool.query('select count(*)::int n from order_details where order_id = $1', [10500]);
  console.log(`# ORM benchmark — REAL PostgreSQL (Northwind)\n`);
  console.log(`(sanity: ${r.rows[0].n} customers; order 10500 has ${d.rows[0].n} line items)\n`);
}

type Impl = () => Promise<void>;
const queries: Record<string, Record<string, Impl>> = {
  'customer-by-id': {
    drizzle: async () => void (await ddb.execute(sql`select * from customers where id = ${42}`)),
    kysely: async () => void (await k.selectFrom('customers').selectAll().where('id', '=', 42).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('customers').where('id', '=', 42).compile();
      await zexec(c.text, c.parameters as unknown[]);
    },
  },
  'customers-paginated': {
    drizzle: async () =>
      void (await ddb.execute(sql`select * from customers order by id limit ${50} offset ${100}`)),
    kysely: async () =>
      void (await k.selectFrom('customers').selectAll().orderBy('id').limit(50).offset(100).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('customers').orderBy('id', 'asc').limit(50).offset(100).compile();
      await zexec(c.text, c.parameters as unknown[]);
    },
  },
  'orders-with-details': {
    drizzle: async () =>
      void (await ddb.execute(
        sql`select * from orders o left join order_details d on d.order_id = o.id where o.id = ${10500}`,
      )),
    kysely: async () =>
      void (await k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .selectAll()
        .where('orders.id', '=', 10500)
        .execute()),
    zmdb: async () => {
      // zmdb pattern: fetch parent + one batched child query (explicit populate).
      const o = qc.selectFrom('orders').where('id', '=', 10500).compile();
      await zexec(o.text, o.parameters as unknown[]);
      const c = qc.selectFrom('order_details').where('order_id', '=', 10500).compile();
      await zexec(c.text, c.parameters as unknown[]);
    },
  },
};

await sanity();
for (const [name, impls] of Object.entries(queries)) {
  const bench = new Bench({ time: 800 });
  for (const [lib, fn] of Object.entries(impls)) bench.add(lib, fn);
  await bench.run();
  const rows = bench.tasks
    .map((t) => ({ name: t.name, hz: t.result?.hz ?? 0 }))
    .sort((a, b) => b.hz - a.hz);
  console.log(`### ${name}`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(10)} ${Math.round(r.hz).toLocaleString().padStart(10)} ops/s`);
  }
  console.log('');
}
await pool.end();
