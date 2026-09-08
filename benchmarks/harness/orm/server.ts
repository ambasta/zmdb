// Real drizzle-benchmarks-style HTTP server. ORM chosen via ORM env var.
// Exposes the exact upstream routes; hit by the actual k6 script (bench.js).
// Each ORM builds queries with its OWN builder. Routes a builder cannot express
// return HTTP 501 (honest per-route DNF), never a faked 200.
import { serve } from '@hono/node-server';
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler } from '@zmdb/sql';
import { aggregateSelectFrom } from '@zmdb/sql/aggregations';
import { ftsSelectFrom } from '@zmdb/sql/fts';
import { sql, eq, asc, getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, integer, text, numeric } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { Kysely, PostgresDialect, sql as ksql } from 'kysely';
import { Pool } from 'pg';

const ORM = process.env.ORM || 'zmdb';
const PORT = Number(process.env.PORT || 3000);
const pool = new Pool({
  connectionString:
    process.env.PGURL ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/bench',
  max: 12,
});

// Drizzle projects every column in the shared PostgreSQL seed.
const customers = pgTable('customers', {
  id: integer('id').primaryKey(),
  company_name: text('company_name'),
  contact_name: text('contact_name'),
  contact_title: text('contact_title'),
  address: text('address'),
  city: text('city'),
  postal_code: text('postal_code'),
  region: text('region'),
  country: text('country'),
  phone: text('phone'),
  fax: text('fax'),
});
const employees = pgTable('employees', {
  id: integer('id').primaryKey(),
  last_name: text('last_name'),
  first_name: text('first_name'),
  title: text('title'),
  title_of_courtesy: text('title_of_courtesy'),
  birth_date: text('birth_date'),
  hire_date: text('hire_date'),
  address: text('address'),
  city: text('city'),
  postal_code: text('postal_code'),
  country: text('country'),
  home_phone: text('home_phone'),
  extension: integer('extension'),
  notes: text('notes'),
  recipient_id: integer('recipient_id'),
});
const suppliers = pgTable('suppliers', {
  id: integer('id').primaryKey(),
  company_name: text('company_name'),
  contact_name: text('contact_name'),
  contact_title: text('contact_title'),
  address: text('address'),
  city: text('city'),
  region: text('region'),
  postal_code: text('postal_code'),
  country: text('country'),
  phone: text('phone'),
});
const products = pgTable('products', {
  id: integer('id').primaryKey(),
  name: text('name'),
  qt_per_unit: text('qt_per_unit'),
  unit_price: numeric('unit_price'),
  units_in_stock: integer('units_in_stock'),
  units_on_order: integer('units_on_order'),
  reorder_level: integer('reorder_level'),
  discontinued: integer('discontinued'),
  supplier_id: integer('supplier_id'),
});
const orders = pgTable('orders', {
  id: integer('id').primaryKey(),
  order_date: text('order_date'),
  required_date: text('required_date'),
  shipped_date: text('shipped_date'),
  ship_via: integer('ship_via'),
  freight: numeric('freight'),
  ship_name: text('ship_name'),
  ship_city: text('ship_city'),
  ship_region: text('ship_region'),
  ship_postal_code: text('ship_postal_code'),
  ship_country: text('ship_country'),
  customer_id: integer('customer_id'),
  employee_id: integer('employee_id'),
});
const details = pgTable('order_details', {
  unit_price: numeric('unit_price'),
  quantity: integer('quantity'),
  discount: numeric('discount'),
  order_id: integer('order_id'),
  product_id: integer('product_id'),
});
const employeeColumns = Object.keys(getTableColumns(employees)).map(column => `employees.${column}`);
const productColumns = Object.keys(getTableColumns(products)).map(column => `products.${column}`);
const orderColumns = Object.keys(getTableColumns(orders)).map(column => `orders.${column}`);
const ddb = drizzle(pool, { schema: { customers, employees, suppliers, products, orders, details } });
const k = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new PostgresDialect({ pool }) });
const qc = createQueryCompiler(postgres);
// zmdb query execution. With ZMDB_PREPARED=1 we pass a stable statement `name`
// derived from the compiled SQL text, so Postgres caches the plan server-side
// (prepared statement) and skips per-request planning — a transparent,
// stateless optimization (no identity map / no proxy), aimed at the tail.
// Default (unset) uses unnamed statements, matching the other ORMs here.
const PREPARED = process.env.ZMDB_PREPARED === '1';
const stmtNames = new Map<string, string>();
let stmtSeq = 0;
const nameFor = (stmtText: string) => {
  let n = stmtNames.get(stmtText);
  if (!n) {
    n = 'z' + (stmtSeq++).toString(36);
    stmtNames.set(stmtText, n);
  }
  return n;
};
const zq = (t: string, p: unknown[]) =>
  (PREPARED ? pool.query({ name: nameFor(t), text: t, values: p }) : pool.query(t, p)).then(r => r.rows);

const app = new Hono();
const num = (v: string | undefined, d = 0) => (v == null ? d : Number(v));
const DNF = 501; // honest per-route "cannot express with this builder"

// Route handlers per ORM. `null` = DNF for that ORM.
type H = (q: URLSearchParams) => Promise<unknown>;
const routes: Record<string, Record<string, H | null>> = {
  '/customers': {
    drizzle: async q =>
      ddb
        .select()
        .from(customers)
        .orderBy(asc(customers.id))
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined)),
    kysely: async q =>
      k
        .selectFrom('customers')
        .selectAll()
        .orderBy('id')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = qc
        .selectFrom('customers')
        .orderBy('id', 'asc')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/customer-by-id': {
    drizzle: async q =>
      ddb
        .select()
        .from(customers)
        .where(eq(customers.id, num(q.get('id') ?? undefined))),
    kysely: async q =>
      k
        .selectFrom('customers')
        .selectAll()
        .where('id', '=', num(q.get('id') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = qc
        .selectFrom('customers')
        .where('id', '=', num(q.get('id') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/employees': {
    drizzle: async q =>
      ddb
        .select()
        .from(employees)
        .orderBy(asc(employees.id))
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined)),
    kysely: async q =>
      k
        .selectFrom('employees')
        .selectAll()
        .orderBy('id')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = qc
        .selectFrom('employees')
        .orderBy('id', 'asc')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/employee-with-recipient': {
    drizzle: async q =>
      ddb
        .select({ ...getTableColumns(employees), recipient: sql`row_to_json(r)` })
        .from(employees)
        .leftJoin(sql`employees r`, sql`r.id = ${employees.recipient_id}`)
        .where(eq(employees.id, num(q.get('id') ?? undefined))),
    kysely: async q =>
      k
        .selectFrom('employees')
        .leftJoin('employees as r', 'r.id', 'employees.recipient_id')
        .selectAll('employees')
        .select(ksql`row_to_json(r)`.as('recipient'))
        .where('employees.id', '=', num(q.get('id') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = aggregateSelectFrom('employees', postgres)
        .select(employeeColumns)
        .expr('row_to_json(r)', 'recipient')
        .leftJoin('employees as r', 'r.id', 'employees.recipient_id')
        .where('employees.id', '=', num(q.get('id') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/suppliers': {
    drizzle: async q =>
      ddb
        .select()
        .from(suppliers)
        .orderBy(asc(suppliers.id))
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined)),
    kysely: async q =>
      k
        .selectFrom('suppliers')
        .selectAll()
        .orderBy('id')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = qc
        .selectFrom('suppliers')
        .orderBy('id', 'asc')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/supplier-by-id': {
    drizzle: async q =>
      ddb
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, num(q.get('id') ?? undefined))),
    kysely: async q =>
      k
        .selectFrom('suppliers')
        .selectAll()
        .where('id', '=', num(q.get('id') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = qc
        .selectFrom('suppliers')
        .where('id', '=', num(q.get('id') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/products': {
    drizzle: async q =>
      ddb
        .select()
        .from(products)
        .orderBy(asc(products.id))
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined)),
    kysely: async q =>
      k
        .selectFrom('products')
        .selectAll()
        .orderBy('id')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = qc
        .selectFrom('products')
        .orderBy('id', 'asc')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/product-with-supplier': {
    drizzle: async q =>
      ddb
        .select({ ...getTableColumns(products), supplier: sql`row_to_json(${suppliers})` })
        .from(products)
        .leftJoin(suppliers, eq(suppliers.id, products.supplier_id))
        .where(eq(products.id, num(q.get('id') ?? undefined))),
    kysely: async q =>
      k
        .selectFrom('products')
        .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
        .selectAll('products')
        .select(ksql`row_to_json(suppliers)`.as('supplier'))
        .where('products.id', '=', num(q.get('id') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = aggregateSelectFrom('products', postgres)
        .select(productColumns)
        .expr('row_to_json(suppliers)', 'supplier')
        .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
        .where('products.id', '=', num(q.get('id') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/orders-with-details': {
    drizzle: async q =>
      ddb
        .select({ id: orders.id, cnt: sql`count(${details.product_id})::int` })
        .from(orders)
        .leftJoin(details, eq(details.order_id, orders.id))
        .groupBy(orders.id)
        .orderBy(asc(orders.id))
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined)),
    kysely: async q =>
      k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .select(['orders.id'])
        .select(ksql`count(order_details.product_id)::int`.as('cnt'))
        .groupBy('orders.id')
        .orderBy('orders.id')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = aggregateSelectFrom('orders', postgres)
        .select(['orders.id'])
        .expr('count(order_details.product_id)::int', 'cnt')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .groupBy('orders.id')
        .orderBy('orders.id', 'asc')
        .limit(num(q.get('limit') ?? undefined, 50))
        .offset(num(q.get('offset') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/order-with-details': {
    drizzle: async q =>
      ddb
        .select({ id: orders.id, cnt: sql`count(${details.product_id})::int` })
        .from(orders)
        .leftJoin(details, eq(details.order_id, orders.id))
        .where(eq(orders.id, num(q.get('id') ?? undefined)))
        .groupBy(orders.id),
    kysely: async q =>
      k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .select(['orders.id'])
        .select(ksql`count(order_details.product_id)::int`.as('cnt'))
        .where('orders.id', '=', num(q.get('id') ?? undefined))
        .groupBy('orders.id')
        .execute(),
    zmdb: async q => {
      const c = aggregateSelectFrom('orders', postgres)
        .select(['orders.id'])
        .expr('count(order_details.product_id)::int', 'cnt')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .where('orders.id', '=', num(q.get('id') ?? undefined))
        .groupBy('orders.id')
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/order-with-details-and-products': {
    drizzle: async q =>
      ddb
        .select({ ...getTableColumns(orders), detail: sql`row_to_json(${details})` })
        .from(orders)
        .leftJoin(details, eq(details.order_id, orders.id))
        .where(eq(orders.id, num(q.get('id') ?? undefined))),
    kysely: async q =>
      k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .selectAll('orders')
        .select(ksql`row_to_json(order_details)`.as('detail'))
        .where('orders.id', '=', num(q.get('id') ?? undefined))
        .execute(),
    zmdb: async q => {
      const c = aggregateSelectFrom('orders', postgres)
        .select(orderColumns)
        .expr('row_to_json(order_details)', 'detail')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .where('orders.id', '=', num(q.get('id') ?? undefined))
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/search-customer': {
    drizzle: async q =>
      ddb
        .select()
        .from(customers)
        .where(
          sql`to_tsvector('english', ${customers.company_name}) @@ to_tsquery('english', ${q.get('term') ?? 'ltd'})`,
        ),
    kysely: async q =>
      k
        .selectFrom('customers')
        .selectAll()
        .where(ksql<boolean>`to_tsvector('english', company_name) @@ to_tsquery('english', ${q.get('term') ?? 'ltd'})`)
        .execute(),
    zmdb: async q => {
      const c = ftsSelectFrom('customers', postgres)
        .whereMatch('company_name', q.get('term') ?? 'ltd')
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
  '/search-product': {
    drizzle: async q =>
      ddb
        .select()
        .from(products)
        .where(sql`to_tsvector('english', ${products.name}) @@ to_tsquery('english', ${q.get('term') ?? 'chai'})`),
    kysely: async q =>
      k
        .selectFrom('products')
        .selectAll()
        .where(ksql<boolean>`to_tsvector('english', name) @@ to_tsquery('english', ${q.get('term') ?? 'chai'})`)
        .execute(),
    zmdb: async q => {
      const c = ftsSelectFrom('products', postgres)
        .whereMatch('name', q.get('term') ?? 'chai')
        .compile();
      return zq(c.text, c.parameters as unknown[]);
    },
  },
};

for (const [path, byOrm] of Object.entries(routes)) {
  const handler = byOrm[ORM];
  app.get(path, async c => {
    if (handler == null) return c.json({ dnf: true, orm: ORM, route: path }, DNF);
    const rows = await handler(new URL(c.req.url).searchParams);
    return c.json(rows as never);
  });
}

serve({ fetch: app.fetch, port: PORT });
console.log(`${ORM} server on :${PORT}`);
