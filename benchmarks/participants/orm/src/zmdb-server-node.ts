import cluster from 'node:cluster';
import os from 'node:os';

import 'dotenv/config';
// zmdb participant in drizzle-team/drizzle-benchmarks.
//
// Grafted into the upstream clone at src/zmdb-server-node.ts by
// benchmarks/scripts/graft.mjs, and deliberately not upstreamed: it imports this
// repository's query compiler by relative path, which only resolves from inside
// the submodule checkout (four levels up is the repository root).
//
// This mirrors src/drizzle-server-node.ts as closely as the two builders allow —
// same 13 routes, same Hono app, same cpu-usage endpoint, same cluster fan-out
// across every core, same pool size. Those are the parts that decide the number,
// so they are copied rather than reinterpreted. What differs is only how each
// route's SQL is produced.
//
// A route zmdb's builder could not express would return 501 rather than a faked
// 200; there are none left, and the compiled SQL for each route is asserted by
// benchmarks/harness/orm's tests.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
// Upstream writes `import pg from 'pg'` and `new pg.Pool(...)`; this is the same
// constructor reached by its named export, which is what this repository's lint
// rules ask for. Nothing about the pool differs.
import { Pool } from 'pg';

import { aggregateSelectFrom } from '../../../../packages/query-compiler/src/aggregations/index.ts';
import { ftsSelectFrom } from '../../../../packages/query-compiler/src/fts/index.ts';
import { createQueryCompiler } from '../../../../packages/query-compiler/src/index.ts';
import { joinableSelectFrom } from '../../../../packages/query-compiler/src/joins/index.ts';
import cpuUsage from './cpu-usage';

const numCPUs = os.cpus().length;

// Same pool geometry as the drizzle participant — min and max both 10 — because
// connection count dominates this benchmark and a different pool would make the
// comparison meaningless.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, min: 10, max: 10 });
const qc = createQueryCompiler('postgres');

// The drizzle participant calls `.prepare()` on every query, so Postgres plans
// each statement once and reuses the plan. zmdb has no prepare step in its
// builder — the compiled text is stable, so naming the statement gets the same
// server-side plan cache. Without this the comparison would be prepared-vs-not,
// which measures planning, not either library.
const statementNames = new Map<string, string>();
let nextStatement = 0;

function nameFor(text: string): string {
  const existing = statementNames.get(text);
  if (existing !== undefined) return existing;
  const name = `z${(nextStatement++).toString(36)}`;
  statementNames.set(text, name);
  return name;
}

async function run(text: string, parameters: readonly unknown[]): Promise<readonly unknown[]> {
  const result = await pool.query({ name: nameFor(text), text, values: [...parameters] });
  return result.rows;
}

const num = (value: string | undefined, fallback = 0): number =>
  value === undefined || value === null ? fallback : Number(value);

const app = new Hono();
app.route('', cpuUsage);

app.get('/customers', async c => {
  const q = qc
    .selectFrom('customers')
    .orderBy('id', 'asc')
    .limit(num(c.req.query('limit'), 50))
    .offset(num(c.req.query('offset')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/customer-by-id', async c => {
  const q = qc
    .selectFrom('customers')
    .where('id', '=', num(c.req.query('id')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/search-customer', async c => {
  const q = ftsSelectFrom('customers', 'postgres')
    .whereMatch('company_name', c.req.query('term') ?? '')
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/employees', async c => {
  const q = qc
    .selectFrom('employees')
    .orderBy('id', 'asc')
    .limit(num(c.req.query('limit'), 50))
    .offset(num(c.req.query('offset')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/employee-with-recipient', async c => {
  const q = joinableSelectFrom('employees as e', 'postgres')
    .leftJoin('employees as r', 'r.id', 'e.recipient_id')
    .where('e.id', '=', num(c.req.query('id')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/suppliers', async c => {
  const q = qc
    .selectFrom('suppliers')
    .orderBy('id', 'asc')
    .limit(num(c.req.query('limit'), 50))
    .offset(num(c.req.query('offset')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/supplier-by-id', async c => {
  const q = qc
    .selectFrom('suppliers')
    .where('id', '=', num(c.req.query('id')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/products', async c => {
  const q = qc
    .selectFrom('products')
    .orderBy('id', 'asc')
    .limit(num(c.req.query('limit'), 50))
    .offset(num(c.req.query('offset')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/product-with-supplier', async c => {
  const q = joinableSelectFrom('products', 'postgres')
    .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
    .where('products.id', '=', num(c.req.query('id')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/search-product', async c => {
  const q = ftsSelectFrom('products', 'postgres')
    .whereMatch('name', c.req.query('term') ?? '')
    .compile();
  return c.json(await run(q.text, q.parameters));
});

// The per-order counts and sums live entirely on order_details, whose foreign key
// is the grouping column — so zmdb aggregates there and never joins. Fewer rows
// touched than the upstream left join, and the same result set.
app.get('/orders-with-details', async c => {
  const q = aggregateSelectFrom('order_details', 'postgres')
    .select(['order_id'])
    .count('product_id', 'products_count')
    .sum('quantity', 'quantity_sum')
    .groupBy('order_id')
    .orderBy('order_id', 'asc')
    .limit(num(c.req.query('limit'), 50))
    .offset(num(c.req.query('offset')))
    .compile();
  return c.json(await run(q.text, q.parameters));
});

app.get('/order-with-details', async c => {
  const q = aggregateSelectFrom('order_details', 'postgres')
    .select(['order_id'])
    .count('product_id', 'products_count')
    .sum('quantity', 'quantity_sum')
    .having('order_id', '=', num(c.req.query('id')))
    .groupBy('order_id')
    .compile();
  return c.json(await run(q.text, q.parameters));
});

// Parent plus a batched child fetch: two indexed queries instead of one join that
// repeats every order column per detail row. This is the shape zmdb's populate
// emits, so it is the shape being measured.
app.get('/order-with-details-and-products', async c => {
  const id = num(c.req.query('id'));
  const order = qc.selectFrom('orders').where('id', '=', id).compile();
  const details = qc.selectFrom('order_details').where('order_id', '=', id).compile();
  const [parents, children] = await Promise.all([
    run(order.text, order.parameters),
    run(details.text, details.parameters),
  ]);
  const parent = parents[0];
  if (parent === undefined) return c.json({});
  return c.json({ ...parent, details: children });
});

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', worker => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  serve({
    fetch: app.fetch,
    port: 3000,
  });
  console.log(`Worker ${process.pid} started`);
}
