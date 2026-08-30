// Real drizzle-benchmarks-style HTTP server. ORM chosen via ORM env var.
// Exposes the exact upstream routes; hit by the actual k6 script (bench.js).
// Each ORM builds queries with its OWN builder. Routes a builder cannot express
// return HTTP 501 (honest per-route DNF), never a faked 200.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, asc } from 'drizzle-orm';
import { pgTable, integer, text, numeric } from 'drizzle-orm/pg-core';
import { Kysely, PostgresDialect, sql as ksql } from 'kysely';
import { createQueryCompiler } from '../../../packages/query-compiler/src/index.ts';
import { ftsSelectFrom } from '../../../packages/query-compiler/src/fts/index.ts';
import { joinableSelectFrom } from '../../../packages/query-compiler/src/joins/index.ts';
import { aggregateSelectFrom } from '../../../packages/query-compiler/src/aggregations/index.ts';

const ORM = process.env.ORM || 'zmdb';
const PORT = Number(process.env.PORT || 3000);
const pool = new pg.Pool({ connectionString: 'postgres://postgres:postgres@localhost:55432/bench', max: 12 });

// drizzle schema
const customers = pgTable('customers', { id: integer('id').primaryKey(), companyName: text('company_name') });
const employees = pgTable('employees', { id: integer('id').primaryKey(), recipientId: integer('recipient_id') });
const suppliers = pgTable('suppliers', { id: integer('id').primaryKey() });
const products = pgTable('products', { id: integer('id').primaryKey(), name: text('name'), supplierId: integer('supplier_id') });
const orders = pgTable('orders', { id: integer('id').primaryKey() });
const details = pgTable('order_details', { orderId: integer('order_id'), productId: integer('product_id'), quantity: integer('quantity'), unitPrice: numeric('unit_price') });
const ddb = drizzle(pool, { schema: { customers, employees, suppliers, products, orders, details } });
const k = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new PostgresDialect({ pool }) });
const qc = createQueryCompiler('postgres');
// zmdb query execution. With ZMDB_PREPARED=1 we pass a stable statement `name`
// derived from the compiled SQL text, so Postgres caches the plan server-side
// (prepared statement) and skips per-request planning — a transparent,
// stateless optimization (no identity map / no proxy), aimed at the tail.
// Default (unset) uses the simple protocol, identical to the other ORMs here.
const PREPARED = process.env.ZMDB_PREPARED === '1';
const stmtNames = new Map<string, string>();
let stmtSeq = 0;
const nameFor = (stmtText: string) => {
  let n = stmtNames.get(stmtText);
  if (!n) { n = 'z' + (stmtSeq++).toString(36); stmtNames.set(stmtText, n); }
  return n;
};
const zq = (t: string, p: unknown[]) =>
  (PREPARED
    ? pool.query({ name: nameFor(t), text: t, values: p })
    : pool.query(t, p)
  ).then((r) => r.rows);

const app = new Hono();
const num = (v: string | undefined, d = 0) => (v == null ? d : Number(v));
const DNF = 501; // honest per-route "cannot express with this builder"

// Route handlers per ORM. `null` = DNF for that ORM.
type H = (q: URLSearchParams) => Promise<unknown>;
const routes: Record<string, Record<string, H | null>> = {
  '/customers': {
    drizzle: async (q) => ddb.select().from(customers).orderBy(asc(customers.id)).limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)),
    kysely: async (q) => k.selectFrom('customers').selectAll().orderBy('id').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).execute(),
    zmdb: async (q) => { const c = qc.selectFrom('customers').orderBy('id', 'asc').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/customer-by-id': {
    drizzle: async (q) => ddb.select().from(customers).where(eq(customers.id, num(q.get('id') ?? undefined))),
    kysely: async (q) => k.selectFrom('customers').selectAll().where('id', '=', num(q.get('id') ?? undefined)).execute(),
    zmdb: async (q) => { const c = qc.selectFrom('customers').where('id', '=', num(q.get('id') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/employees': {
    drizzle: async (q) => ddb.select().from(employees).orderBy(asc(employees.id)).limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)),
    kysely: async (q) => k.selectFrom('employees').selectAll().orderBy('id').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).execute(),
    zmdb: async (q) => { const c = qc.selectFrom('employees').orderBy('id', 'asc').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/employee-with-recipient': {
    drizzle: async (q) => ddb.select().from(employees).leftJoin(sql`employees r`, sql`r.id = ${employees.recipientId}`).where(eq(employees.id, num(q.get('id') ?? undefined))),
    kysely: async (q) => k.selectFrom('employees').leftJoin('employees as r', 'r.id', 'employees.recipient_id').selectAll('employees').where('employees.id', '=', num(q.get('id') ?? undefined)).execute(),
    zmdb: async (q) => { const c = joinableSelectFrom('employees as e', 'postgres').leftJoin('employees as r', 'r.id', 'e.recipient_id').where('e.id', '=', num(q.get('id') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/suppliers': {
    drizzle: async (q) => ddb.select().from(suppliers).orderBy(asc(suppliers.id)).limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)),
    kysely: async (q) => k.selectFrom('suppliers').selectAll().orderBy('id').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).execute(),
    zmdb: async (q) => { const c = qc.selectFrom('suppliers').orderBy('id', 'asc').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/supplier-by-id': {
    drizzle: async (q) => ddb.select().from(suppliers).where(eq(suppliers.id, num(q.get('id') ?? undefined))),
    kysely: async (q) => k.selectFrom('suppliers').selectAll().where('id', '=', num(q.get('id') ?? undefined)).execute(),
    zmdb: async (q) => { const c = qc.selectFrom('suppliers').where('id', '=', num(q.get('id') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/products': {
    drizzle: async (q) => ddb.select().from(products).orderBy(asc(products.id)).limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)),
    kysely: async (q) => k.selectFrom('products').selectAll().orderBy('id').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).execute(),
    zmdb: async (q) => { const c = qc.selectFrom('products').orderBy('id', 'asc').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/product-with-supplier': {
    drizzle: async (q) => ddb.select().from(products).leftJoin(suppliers, eq(suppliers.id, products.supplierId)).where(eq(products.id, num(q.get('id') ?? undefined))),
    kysely: async (q) => k.selectFrom('products').leftJoin('suppliers', 'suppliers.id', 'products.supplier_id').selectAll().where('products.id', '=', num(q.get('id') ?? undefined)).execute(),
    zmdb: async (q) => { const c = joinableSelectFrom('products', 'postgres').leftJoin('suppliers', 'suppliers.id', 'products.supplier_id').where('products.id', '=', num(q.get('id') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/orders-with-details': {
    drizzle: async (q) => ddb.select({ id: orders.id, cnt: sql`count(${details.productId})::int` }).from(orders).leftJoin(details, eq(details.orderId, orders.id)).groupBy(orders.id).orderBy(asc(orders.id)).limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)),
    kysely: async (q) => k.selectFrom('orders').leftJoin('order_details', 'order_details.order_id', 'orders.id').select(['orders.id']).select(ksql`count(order_details.product_id)::int`.as('cnt')).groupBy('orders.id').orderBy('orders.id').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).execute(),
    // zmdb: aggregate directly on order_details grouped by order_id (the FK lives
    // there, so no join is needed for the per-order counts/sums).
    zmdb: async (q) => { const c = aggregateSelectFrom('order_details', 'postgres').select(['order_id']).count('product_id', 'products_count').sum('quantity', 'quantity_sum').groupBy('order_id').orderBy('order_id', 'asc').limit(num(q.get('limit') ?? undefined, 50)).offset(num(q.get('offset') ?? undefined)).compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/order-with-details': {
    drizzle: async (q) => ddb.select({ id: orders.id, cnt: sql`count(${details.productId})::int` }).from(orders).leftJoin(details, eq(details.orderId, orders.id)).where(eq(orders.id, num(q.get('id') ?? undefined))).groupBy(orders.id),
    kysely: async (q) => k.selectFrom('orders').leftJoin('order_details', 'order_details.order_id', 'orders.id').select(['orders.id']).select(ksql`count(order_details.product_id)::int`.as('cnt')).where('orders.id', '=', num(q.get('id') ?? undefined)).groupBy('orders.id').execute(),
    // zmdb: aggregate on order_details for the single order id (no join needed).
    zmdb: async (q) => { const c = aggregateSelectFrom('order_details', 'postgres').select(['order_id']).count('product_id', 'products_count').sum('quantity', 'quantity_sum').having('order_id', '=', num(q.get('id') ?? undefined)).groupBy('order_id').compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/order-with-details-and-products': {
    drizzle: async (q) => ddb.select().from(orders).leftJoin(details, eq(details.orderId, orders.id)).where(eq(orders.id, num(q.get('id') ?? undefined))),
    kysely: async (q) => k.selectFrom('orders').leftJoin('order_details', 'order_details.order_id', 'orders.id').selectAll().where('orders.id', '=', num(q.get('id') ?? undefined)).execute(),
    // zmdb idiom: explicit parent + batched children (two CRUD queries).
    zmdb: async (q) => { const id = num(q.get('id') ?? undefined); const o = qc.selectFrom('orders').where('id', '=', id).compile(); const parent = await zq(o.text, o.parameters as unknown[]); const d = qc.selectFrom('order_details').where('order_id', '=', id).compile(); const kids = await zq(d.text, d.parameters as unknown[]); return { ...parent[0], details: kids }; },
  },
  // #97 — /search-* now served by zmdb via the FTS builder (was DNF).
  '/search-customer': {
    drizzle: async (q) => ddb.execute(sql`select * from customers where to_tsvector('english', company_name) @@ to_tsquery('english', ${q.get('term') ?? 'ltd'})`),
    kysely: async (q) => k.selectFrom('customers').selectAll().where(ksql<boolean>`to_tsvector('english', company_name) @@ to_tsquery('english', ${q.get('term') ?? 'ltd'})`).execute(),
    zmdb: async (q) => { const c = ftsSelectFrom('customers', 'postgres').whereMatch('company_name', q.get('term') ?? 'ltd').compile(); return zq(c.text, c.parameters as unknown[]); },
  },
  '/search-product': {
    drizzle: async (q) => ddb.execute(sql`select * from products where to_tsvector('english', name) @@ to_tsquery('english', ${q.get('term') ?? 'chai'})`),
    kysely: async (q) => k.selectFrom('products').selectAll().where(ksql<boolean>`to_tsvector('english', name) @@ to_tsquery('english', ${q.get('term') ?? 'chai'})`).execute(),
    zmdb: async (q) => { const c = ftsSelectFrom('products', 'postgres').whereMatch('name', q.get('term') ?? 'chai').compile(); return zq(c.text, c.parameters as unknown[]); },
  },
};

for (const [path, byOrm] of Object.entries(routes)) {
  const handler = byOrm[ORM];
  app.get(path, async (c) => {
    if (handler == null) return c.json({ dnf: true, orm: ORM, route: path }, DNF);
    const rows = await handler(new URL(c.req.url).searchParams);
    return c.json(rows as never);
  });
}

serve({ fetch: app.fetch, port: PORT });
console.log(`${ORM} server on :${PORT}`);
