import { postgres } from '@zmdb/postgres';
import { createQueryCompiler } from '@zmdb/sql';
import { aggregateSelectFrom } from '@zmdb/sql/aggregations';
import { ftsSelectFrom } from '@zmdb/sql/fts';
import { sql, eq, asc, getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, integer, text, numeric } from 'drizzle-orm/pg-core';
import { Kysely, PostgresDialect, sql as ksql } from 'kysely';
// Exact drizzle-benchmarks query set (p1–p13) run against REAL PostgreSQL.
// Each ORM builds the query with its OWN builder API (not shared raw SQL),
// so a query a tool cannot express with its builder is honestly DNF.
// Unsupported workload implementations in this microbenchmark are reported as DNF.
import { Pool } from 'pg';
import { Bench } from 'tinybench';

const pool = new Pool({
  connectionString:
    process.env.PGURL ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/bench',
  max: 10,
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
        .where(sql`to_tsvector('english', ${customers.company_name}) @@ to_tsquery('english', ${'ltd'})`)),
    kysely: async () =>
      void (await k
        .selectFrom('customers')
        .selectAll()
        .where(ksql<boolean>`to_tsvector('english', company_name) @@ to_tsquery('english', ${'ltd'})`)
        .execute()),
    zmdb: async () => {
      const c = ftsSelectFrom('customers', postgres).whereMatch('company_name', 'ltd').compile();
      await z(c.text, c.parameters as unknown[]);
    },
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
    drizzle: async () =>
      void (await ddb
        .select({ ...getTableColumns(employees), recipient: sql`row_to_json(r)` })
        .from(employees)
        .leftJoin(sql`employees r`, sql`r.id = ${employees.recipient_id}`)
        .where(eq(employees.id, 5))),
    kysely: async () =>
      void (await k
        .selectFrom('employees')
        .leftJoin('employees as r', 'r.id', 'employees.recipient_id')
        .selectAll('employees')
        .select(ksql`row_to_json(r)`.as('recipient'))
        .where('employees.id', '=', 5)
        .execute()),
    zmdb: async () => {
      const c = aggregateSelectFrom('employees', postgres)
        .select(employeeColumns)
        .expr('row_to_json(r)', 'recipient')
        .leftJoin('employees as r', 'r.id', 'employees.recipient_id')
        .where('employees.id', '=', 5)
        .compile();
      await z(c.text, c.parameters as unknown[]);
    },
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
        .select({ ...getTableColumns(products), supplier: sql`row_to_json(${suppliers})` })
        .from(products)
        .leftJoin(suppliers, eq(suppliers.id, products.supplier_id))
        .where(eq(products.id, 7))),
    kysely: async () =>
      void (await k
        .selectFrom('products')
        .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
        .selectAll('products')
        .select(ksql`row_to_json(suppliers)`.as('supplier'))
        .where('products.id', '=', 7)
        .execute()),
    zmdb: async () => {
      const c = aggregateSelectFrom('products', postgres)
        .select(productColumns)
        .expr('row_to_json(suppliers)', 'supplier')
        .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
        .where('products.id', '=', 7)
        .compile();
      await z(c.text, c.parameters as unknown[]);
    },
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
    zmdb: async () => {
      const c = ftsSelectFrom('products', postgres).whereMatch('name', 'chai').compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p11 orders+agg list': {
    desc: 'orders w/ aggregated details (GROUP BY, computed cols), paginated',
    drizzle: async () =>
      void (await ddb
        .select({
          id: orders.id,
          products_count: sql`count(${details.product_id})::int`,
          quantity_sum: sql`sum(${details.quantity})::int`,
        })
        .from(orders)
        .leftJoin(details, eq(details.order_id, orders.id))
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
        .select(ksql`sum(order_details.quantity)::int`.as('quantity_sum'))
        .groupBy('orders.id')
        .orderBy('orders.id')
        .limit(50)
        .offset(0)
        .execute()),
    zmdb: async () => {
      const c = aggregateSelectFrom('orders', postgres)
        .select(['orders.id'])
        .expr('count(order_details.product_id)::int', 'products_count')
        .expr('sum(order_details.quantity)::int', 'quantity_sum')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .groupBy('orders.id')
        .orderBy('orders.id', 'asc')
        .limit(50)
        .offset(0)
        .compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p12 order+agg by-id': {
    desc: 'single order w/ aggregated details',
    drizzle: async () =>
      void (await ddb
        .select({ id: orders.id, products_count: sql`count(${details.product_id})::int` })
        .from(orders)
        .leftJoin(details, eq(details.order_id, orders.id))
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
    zmdb: async () => {
      const c = aggregateSelectFrom('orders', postgres)
        .select(['orders.id'])
        .expr('count(order_details.product_id)::int', 'products_count')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .where('orders.id', '=', 10500)
        .groupBy('orders.id')
        .compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
  'p13 order-with-details': {
    desc: 'order + its line items',
    drizzle: async () =>
      void (await ddb
        .select({ ...getTableColumns(orders), detail: sql`row_to_json(${details})` })
        .from(orders)
        .leftJoin(details, eq(details.order_id, orders.id))
        .where(eq(orders.id, 10500))),
    kysely: async () =>
      void (await k
        .selectFrom('orders')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .selectAll('orders')
        .select(ksql`row_to_json(order_details)`.as('detail'))
        .where('orders.id', '=', 10500)
        .execute()),
    zmdb: async () => {
      const c = aggregateSelectFrom('orders', postgres)
        .select(orderColumns)
        .expr('row_to_json(order_details)', 'detail')
        .leftJoin('order_details', 'order_details.order_id', 'orders.id')
        .where('orders.id', '=', 10500)
        .compile();
      await z(c.text, c.parameters as unknown[]);
    },
  },
};

const selected = new Set((process.env.ORMS ?? 'zmdb').trim().split(/\s+/));
const ORMS = (['zmdb', 'drizzle', 'kysely'] as const).filter(orm => selected.has(orm));
if (ORMS.length !== selected.size) throw new Error('ORMS must contain zmdb, drizzle or kysely');
console.log('# ORM benchmark — exact drizzle-benchmarks query set (p1–p13), REAL PostgreSQL\n');
const dnfCount: Record<string, number> = { zmdb: 0, drizzle: 0, kysely: 0 };
const rowsOut: string[] = [`| Query | ${ORMS.join(' | ')} |`, `|-------|${ORMS.map(() => '-----:|').join('')}`];

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
  rowsOut.push(`| ${name} | ${ORMS.map(cell).join(' | ')} |`);
}
console.log(rowsOut.join('\n'));
console.log(
  `\nDNF totals (of ${Object.keys(Q).length} upstream queries): ${ORMS.map(orm => `${orm}=${dnfCount[orm]}`).join(', ')}`,
);
await pool.end();
