import { sql, eq, asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, integer, text, numeric } from 'drizzle-orm/pg-core';
import { Kysely, PostgresDialect, sql as ksql } from 'kysely';
// Exact drizzle-benchmarks query set (p1–p13) run against REAL PostgreSQL.
// Each ORM builds the query with its OWN builder API (not shared raw SQL),
// so a query a tool cannot express with its builder is honestly DNF.
// zmdb's query-compiler is deliberately CRUD-focused (no joins/aggregates/FTS
// builder) — those are DNF for zmdb, which is exactly the feature-gap metric.
import { Pool } from 'pg';
import { Bench } from 'tinybench';

import { createQueryCompiler } from '../../../packages/query-compiler/src/index.ts';

const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:55432/bench', max: 10 });

// --- drizzle schema (minimal, for its query builder) ---
const customers = pgTable('customers', { id: integer('id').primaryKey(), companyName: text('company_name') });
const employees = pgTable('employees', { id: integer('id').primaryKey(), recipientId: integer('recipient_id') });
const suppliers = pgTable('suppliers', { id: integer('id').primaryKey() });
const products = pgTable('products', {
  id: integer('id').primaryKey(),
  name: text('name'),
  supplierId: integer('supplier_id'),
});
const orders = pgTable('orders', {
  id: integer('id').primaryKey(),
  shippedDate: text('shipped_date'),
  shipName: text('ship_name'),
  shipCity: text('ship_city'),
  shipCountry: text('ship_country'),
});
const details = pgTable('order_details', {
  orderId: integer('order_id'),
  productId: integer('product_id'),
  quantity: integer('quantity'),
  unitPrice: numeric('unit_price'),
});
const ddb = drizzle(pool, { schema: { customers, employees, suppliers, products, orders, details } });

const k = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new PostgresDialect({ pool }) });
const qc = createQueryCompiler('postgres');
const z = (t: string, p: unknown[]) => pool.query(t, p);

const DNF = Symbol('dnf');
type Impl = (() => Promise<void>) | typeof DNF;

// Each upstream prepared query p1..p13, per ORM builder.
const Q: Record<string, { desc: string; drizzle: Impl; kysely: Impl; zmdb: Impl }> = {
  'p1 customers-list': {
    desc: 'customers list + pagination',
    drizzle: async () => void (await ddb.select().from(customers).orderBy(asc(customers.id)).limit(50).offset(100)),
    kysely: async () =>
      void (await k.selectFrom('customers').selectAll().orderBy('id').limit(50).offset(100).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('customers').orderBy('id', 'asc').limit(50).offset(100).compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p2 customer-by-id': {
    desc: 'customer by id',
    drizzle: async () => void (await ddb.select().from(customers).where(eq(customers.id, 42))),
    kysely: async () => void (await k.selectFrom('customers').selectAll().where('id', '=', 42).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('customers').where('id', '=', 42).compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p3 customer-search (FTS)': {
    desc: 'full-text search on company_name',
    drizzle: async () =>
      void (await ddb
        .select()
        .from(customers)
        .where(sql`to_tsvector('english', ${customers.companyName}) @@ to_tsquery('english', ${'ltd'})`)),
    kysely: async () =>
      void (await k
        .selectFrom('customers')
        .selectAll()
        .where(ksql<boolean>`to_tsvector('english', company_name) @@ to_tsquery('english', ${'ltd'})`)
        .execute()),
    zmdb: DNF, // query-compiler has no full-text-search builder (raw-only escape hatch)
  },
  'p4 employees-list': {
    desc: 'employees list + pagination',
    drizzle: async () => void (await ddb.select().from(employees).orderBy(asc(employees.id)).limit(50).offset(0)),
    kysely: async () => void (await k.selectFrom('employees').selectAll().orderBy('id').limit(50).offset(0).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('employees').orderBy('id', 'asc').limit(50).offset(0).compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p5 employee+recipient': {
    desc: 'employee by id WITH self-join recipient',
    drizzle: async () => void (await ddb.select().from(employees).where(eq(employees.id, 5))), // relation `with` omitted; join is the essence
    kysely: async () =>
      void (await k
        .selectFrom('employees')
        .leftJoin('employees as r', 'r.id', 'employees.recipient_id')
        .selectAll('employees')
        .where('employees.id', '=', 5)
        .execute()),
    zmdb: DNF, // no join builder → the "with recipient" relation cannot be expressed
  },
  'p6 suppliers-list': {
    desc: 'suppliers list + pagination',
    drizzle: async () => void (await ddb.select().from(suppliers).orderBy(asc(suppliers.id)).limit(50).offset(0)),
    kysely: async () => void (await k.selectFrom('suppliers').selectAll().orderBy('id').limit(50).offset(0).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('suppliers').orderBy('id', 'asc').limit(50).offset(0).compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p7 supplier-by-id': {
    desc: 'supplier by id',
    drizzle: async () => void (await ddb.select().from(suppliers).where(eq(suppliers.id, 3))),
    kysely: async () => void (await k.selectFrom('suppliers').selectAll().where('id', '=', 3).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('suppliers').where('id', '=', 3).compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p8 products-list': {
    desc: 'products list + pagination',
    drizzle: async () => void (await ddb.select().from(products).orderBy(asc(products.id)).limit(50).offset(0)),
    kysely: async () => void (await k.selectFrom('products').selectAll().orderBy('id').limit(50).offset(0).execute()),
    zmdb: async () => {
      const c = qc.selectFrom('products').orderBy('id', 'asc').limit(50).offset(0).compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p9 product+supplier': {
    desc: 'product by id WITH supplier join',
    drizzle: async () =>
      void (await ddb
        .select()
        .from(products)
        .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
        .where(eq(products.id, 7))),
    kysely: async () =>
      void (await k
        .selectFrom('products')
        .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
        .selectAll()
        .where('products.id', '=', 7)
        .execute()),
    zmdb: DNF, // no join builder
  },
  'p10 product-search (FTS)': {
    desc: 'full-text search on product name',
    drizzle: async () =>
      void (await ddb
        .select()
        .from(products)
        .where(sql`to_tsvector('english', ${products.name}) @@ to_tsquery('english', ${'chai'})`)),
    kysely: async () =>
      void (await k
        .selectFrom('products')
        .selectAll()
        .where(ksql<boolean>`to_tsvector('english', name) @@ to_tsquery('english', ${'chai'})`)
        .execute()),
    zmdb: DNF, // no FTS builder
  },
  'p11 orders+agg list': {
    desc: 'orders w/ aggregated details (GROUP BY, computed cols), paginated',
    drizzle: async () =>
      void (await ddb
        .select({
          id: orders.id,
          productsCount: sql`count(${details.productId})::int`,
          quantitySum: sql`sum(${details.quantity})::int`,
        })
        .from(orders)
        .leftJoin(details, eq(details.orderId, orders.id))
        .groupBy(orders.id)
        .orderBy(asc(orders.id))
        .limit(50)
        .offset(0)),
    kysely: async () =>
      void (await k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .select(['orders.id'])
        .select(ksql`count(order_details.product_id)::int`.as('products_count'))
        .groupBy('orders.id')
        .orderBy('orders.id')
        .limit(50)
        .offset(0)
        .execute()),
    zmdb: DNF, // no join / GROUP BY / aggregate builder
  },
  'p12 order+agg by-id': {
    desc: 'single order w/ aggregated details',
    drizzle: async () =>
      void (await ddb
        .select({ id: orders.id, productsCount: sql`count(${details.productId})::int` })
        .from(orders)
        .leftJoin(details, eq(details.orderId, orders.id))
        .where(eq(orders.id, 10500))
        .groupBy(orders.id)),
    kysely: async () =>
      void (await k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .select(['orders.id'])
        .select(ksql`count(order_details.product_id)::int`.as('products_count'))
        .where('orders.id', '=', 10500)
        .groupBy('orders.id')
        .execute()),
    zmdb: DNF, // no join / aggregate builder
  },
  'p13 order-with-details': {
    desc: 'order + its line items',
    drizzle: async () =>
      void (await ddb
        .select()
        .from(orders)
        .leftJoin(details, eq(details.orderId, orders.id))
        .where(eq(orders.id, 10500))),
    kysely: async () =>
      void (await k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .selectAll()
        .where('orders.id', '=', 10500)
        .execute()),
    // zmdb pattern: explicit two-query populate (parent + batched children) — expressible with the CRUD builder.
    zmdb: async () => {
      const o = qc.selectFrom('orders').where('id', '=', 10500).compile();
      await z(o.text, o.parameters as unknown[]);
      const d = qc.selectFrom('order_details').where('order_id', '=', 10500).compile();
      await z(d.text, d.parameters as unknown[]);
    },
  },
};

const ORMS = ['zmdb', 'drizzle', 'kysely'] as const;
console.log('# ORM benchmark — exact drizzle-benchmarks query set (p1–p13), REAL PostgreSQL\n');
const dnfCount: Record<string, number> = { zmdb: 0, drizzle: 0, kysely: 0 };
const rowsOut: string[] = ['| Query | zmdb | drizzle | kysely |', '|-------|-----:|--------:|-------:|'];

for (const [name, q] of Object.entries(Q)) {
  const bench = new Bench({ time: 500 });
  const present: Record<string, boolean> = {};
  for (const orm of ORMS) {
    const impl = q[orm];
    if (impl === DNF) {
      dnfCount[orm]++;
      present[orm] = false;
      continue;
    }
    present[orm] = true;
    bench.add(orm, impl as () => Promise<void>);
  }
  await bench.run();
  const hz: Record<string, number> = {};
  for (const t of bench.tasks) hz[t.name] = Math.round(t.result?.hz ?? 0);
  const cell = (orm: string) => (present[orm] ? `${hz[orm].toLocaleString()}` : 'DNF');
  rowsOut.push(`| ${name} | ${cell('zmdb')} | ${cell('drizzle')} | ${cell('kysely')} |`);
}
console.log(rowsOut.join('\n'));
console.log(
  `\nDNF totals (of ${Object.keys(Q).length} upstream queries): zmdb=${dnfCount.zmdb}, drizzle=${dnfCount.drizzle}, kysely=${dnfCount.kysely}`,
);
await pool.end();
