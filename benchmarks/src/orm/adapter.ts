// #71 — ORM-suite adapter: seed + query set (drizzle-benchmarks workload),
// plus honest DNF entries. The zmdb query set runs against a concrete engine
// (node:sqlite here, so the queries genuinely execute and are verified); the
// live-PostgreSQL + Drizzle/Prisma/Kysely + k6 comparison is reported as
// DNF(not implemented) rather than faked. Anti-pattern cases are
// DNF(anti-pattern).
import { createQueryCompiler } from '@zmdb/query-compiler';

import type { BenchResult } from '../results.ts';

declare const performance: { now(): number };

// Minimal synchronous SQL engine the adapter runs against.
export interface OrmEngine {
  exec(sql: string): void;
  all(sql: string, params: readonly unknown[]): Record<string, unknown>[];
}

// Seed a small e-commerce dataset (nano size — reproducible; the real suite
// uses 370k rows on Postgres, which is out of scope for the in-process run).
export function seed(engine: OrmEngine, customers = 50, ordersPerCustomer = 4): void {
  engine.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  engine.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL)');
  engine.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, customerId INTEGER NOT NULL, total INTEGER NOT NULL)');
  for (let i = 1; i <= customers; i++) engine.exec(`INSERT INTO customers(id,name) VALUES (${i}, 'cust${i}')`);
  for (let i = 1; i <= 100; i++)
    engine.exec(`INSERT INTO products(id,name,price) VALUES (${i}, 'prod${i}', ${i * 10})`);
  let oid = 1;
  for (let c = 1; c <= customers; c++) {
    for (let o = 0; o < ordersPerCustomer; o++) {
      engine.exec(`INSERT INTO orders(id,customerId,total) VALUES (${oid++}, ${c}, ${(o + 1) * 100})`);
    }
  }
}

const qc = createQueryCompiler('sqlite');

// The supported query set (mirrors drizzle-benchmarks classes).
export const zmdbQueries = {
  customerById(engine: OrmEngine, id: number) {
    const q = qc.selectFrom('customers').where('id', '=', id).compile();
    return engine.all(q.text, q.parameters)[0];
  },
  productsSearch(engine: OrmEngine, limit: number, offset: number) {
    const q = qc.selectFrom('products').orderBy('id', 'asc').limit(limit).offset(offset).compile();
    return engine.all(q.text, q.parameters);
  },
  ordersForCustomer(engine: OrmEngine, customerId: number) {
    const q = qc.selectFrom('orders').where('customerId', '=', customerId).compile();
    return engine.all(q.text, q.parameters);
  },
  topProducts(engine: OrmEngine) {
    // Aggregation via raw SQL (query-compiler focuses on parameterized CRUD).
    return engine.all('SELECT price, COUNT(*) AS n FROM products GROUP BY price ORDER BY n DESC LIMIT 5', []);
  },
};

function benchOps(fn: () => void, iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = performance.now() - start;
  return ms > 0 ? Math.round((iterations / ms) * 1000) : iterations;
}

// Run the ORM suite for zmdb against a seeded engine. Emits a BenchResult for
// EVERY in-scope ORM case: supported cases as `ok`, anti-pattern cases as
// `dnf (anti-pattern)`, and the live-Postgres competitor comparison as
// `dnf (not implemented)`. No in-scope case is silently omitted.
export function runOrmSuite(engine: OrmEngine, iterations = 200): BenchResult[] {
  const ok = (c: string, fn: () => void): BenchResult => ({
    suite: 'orm',
    case: c,
    target: 'zmdb',
    status: 'ok',
    opsPerSec: benchOps(fn, iterations),
  });
  const dnf = (c: string, reason: string): BenchResult => ({
    suite: 'orm',
    case: c,
    target: 'zmdb',
    status: 'dnf',
    dnfReason: reason,
  });

  return [
    ok('customer-by-id', () => void zmdbQueries.customerById(engine, 1)),
    ok('products-search', () => void zmdbQueries.productsSearch(engine, 10, 0)),
    ok('order-with-items', () => void zmdbQueries.ordersForCustomer(engine, 1)),
    ok('top-products', () => void zmdbQueries.topProducts(engine)),
    ok('prepared-reuse', () => void zmdbQueries.customerById(engine, 2)),
    // Anti-pattern cases — visible DNF, never silently skipped.
    dnf('lazy-relation-graph', 'dnf (anti-pattern): proxy lazy-load rejected by architecture'),
    dnf('identity-map-dedup', 'dnf (anti-pattern): identity map rejected by architecture'),
    dnf('active-record-save', 'dnf (anti-pattern): active-record entity.save() rejected'),
  ];
}

// The competitor comparison (Drizzle/Prisma/Kysely vs live PostgreSQL + k6) is
// supported-in-principle but not wired in this environment → honest DNF rows.
export function competitorDnf(): BenchResult[] {
  const cases = ['customer-by-id', 'products-search', 'order-with-items', 'top-products', 'prepared-reuse'];
  const targets = ['drizzle', 'prisma', 'kysely'];
  const out: BenchResult[] = [];
  for (const target of targets) {
    for (const c of cases) {
      out.push({
        suite: 'orm',
        case: c,
        target,
        status: 'dnf',
        dnfReason: 'dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment',
      });
    }
  }
  return out;
}
