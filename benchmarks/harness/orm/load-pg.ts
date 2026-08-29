// Load the real Northwind dataset (customers/orders/order_details) from the
// drizzle-benchmarks SQLite DB into PostgreSQL, so the ORM benchmark runs
// against real Postgres (not SQLite).
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const sqlite = new DatabaseSync('northwind.db');
const client = new pg.Client({ connectionString: 'postgres://postgres:postgres@localhost:55432/bench' });
await client.connect();

await client.query(`
  DROP TABLE IF EXISTS order_details, orders, customers CASCADE;
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY, company_name TEXT, contact_name TEXT, contact_title TEXT,
    address TEXT, city TEXT, postal_code TEXT, region TEXT, country TEXT, phone TEXT, fax TEXT
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY, order_date TEXT, required_date TEXT, shipped_date TEXT,
    ship_via INTEGER, freight NUMERIC, ship_name TEXT, ship_city TEXT, ship_region TEXT,
    ship_postal_code TEXT, ship_country TEXT, customer_id INTEGER, employee_id INTEGER
  );
  CREATE TABLE order_details (
    unit_price NUMERIC, quantity INTEGER, discount NUMERIC, order_id INTEGER, product_id INTEGER
  );
  CREATE INDEX ON order_details(order_id);
  CREATE INDEX ON orders(customer_id);
`);

async function bulkInsert(table: string, cols: string[]) {
  const rows = sqlite.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all() as Record<string, unknown>[];
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((r, ri) => {
      const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
      for (const c of cols) values.push(r[c]);
      return `(${ph.join(',')})`;
    });
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, values);
  }
  return rows.length;
}

const c = await bulkInsert('customers', ['id', 'company_name', 'contact_name', 'contact_title', 'address', 'city', 'postal_code', 'region', 'country', 'phone', 'fax']);
const o = await bulkInsert('orders', ['id', 'order_date', 'required_date', 'shipped_date', 'ship_via', 'freight', 'ship_name', 'ship_city', 'ship_region', 'ship_postal_code', 'ship_country', 'customer_id', 'employee_id']);
const d = await bulkInsert('order_details', ['unit_price', 'quantity', 'discount', 'order_id', 'product_id']);
await client.query('ANALYZE');
console.log(`loaded into postgres: ${c} customers, ${o} orders, ${d} order_details`);
await client.end();
