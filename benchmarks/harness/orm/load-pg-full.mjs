// Load the FULL Northwind dataset (all tables) from the drizzle-benchmarks
// SQLite DB into PostgreSQL, so the exact upstream query set (p1–p13) can run.
import { DatabaseSync } from 'node:sqlite';

import { Client } from 'pg';

const sqlite = new DatabaseSync('northwind.db');
const client = new Client({ connectionString: 'postgres://postgres:postgres@localhost:55432/bench' });
await client.connect();

// integer date columns kept as BIGINT where numeric, TEXT where ISO strings.
await client.query(`
  DROP TABLE IF EXISTS order_details, orders, products, suppliers, employees, customers CASCADE;
  CREATE TABLE customers (id INT PRIMARY KEY, company_name TEXT, contact_name TEXT, contact_title TEXT, address TEXT, city TEXT, postal_code TEXT, region TEXT, country TEXT, phone TEXT, fax TEXT);
  CREATE TABLE employees (id INT PRIMARY KEY, last_name TEXT, first_name TEXT, title TEXT, title_of_courtesy TEXT, birth_date TEXT, hire_date TEXT, address TEXT, city TEXT, postal_code TEXT, country TEXT, home_phone TEXT, extension INT, notes TEXT, recipient_id INT);
  CREATE TABLE suppliers (id INT PRIMARY KEY, company_name TEXT, contact_name TEXT, contact_title TEXT, address TEXT, city TEXT, region TEXT, postal_code TEXT, country TEXT, phone TEXT);
  CREATE TABLE products (id INT PRIMARY KEY, name TEXT, qt_per_unit TEXT, unit_price NUMERIC, units_in_stock INT, units_on_order INT, reorder_level INT, discontinued INT, supplier_id INT);
  CREATE TABLE orders (id INT PRIMARY KEY, order_date TEXT, required_date TEXT, shipped_date TEXT, ship_via INT, freight NUMERIC, ship_name TEXT, ship_city TEXT, ship_region TEXT, ship_postal_code TEXT, ship_country TEXT, customer_id INT, employee_id INT);
  CREATE TABLE order_details (unit_price NUMERIC, quantity INT, discount NUMERIC, order_id INT, product_id INT);
  CREATE INDEX ON order_details(order_id);
  CREATE INDEX ON orders(customer_id);
  CREATE INDEX ON products(supplier_id);
  CREATE INDEX ON employees(recipient_id);
`);

async function load(table, cols) {
  const rows = sqlite.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all();
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const tuples = chunk.map((r, ri) => {
      const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
      for (const c of cols) values.push(r[c]);
      return `(${ph.join(',')})`;
    });
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, values);
  }
  return rows.length;
}

const counts = {};
counts.customers = await load('customers', [
  'id',
  'company_name',
  'contact_name',
  'contact_title',
  'address',
  'city',
  'postal_code',
  'region',
  'country',
  'phone',
  'fax',
]);
counts.employees = await load('employees', [
  'id',
  'last_name',
  'first_name',
  'title',
  'title_of_courtesy',
  'birth_date',
  'hire_date',
  'address',
  'city',
  'postal_code',
  'country',
  'home_phone',
  'extension',
  'notes',
  'recipient_id',
]);
counts.suppliers = await load('suppliers', [
  'id',
  'company_name',
  'contact_name',
  'contact_title',
  'address',
  'city',
  'region',
  'postal_code',
  'country',
  'phone',
]);
counts.products = await load('products', [
  'id',
  'name',
  'qt_per_unit',
  'unit_price',
  'units_in_stock',
  'units_on_order',
  'reorder_level',
  'discontinued',
  'supplier_id',
]);
counts.orders = await load('orders', [
  'id',
  'order_date',
  'required_date',
  'shipped_date',
  'ship_via',
  'freight',
  'ship_name',
  'ship_city',
  'ship_region',
  'ship_postal_code',
  'ship_country',
  'customer_id',
  'employee_id',
]);
counts.order_details = await load('order_details', ['unit_price', 'quantity', 'discount', 'order_id', 'product_id']);
await client.query('ANALYZE');
console.log('loaded:', JSON.stringify(counts));
await client.end();
