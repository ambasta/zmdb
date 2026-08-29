import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { seed, zmdbQueries, runOrmSuite, competitorDnf, type OrmEngine } from './adapter.ts';
import { validateResult, validateCoverage, IN_SCOPE_CASES } from '../results.ts';

// #71: ORM-suite adapter + seed + query set, with honest DNF reporting.

function sqliteEngine(db: DatabaseSync): OrmEngine {
  return {
    exec: (sql) => db.exec(sql),
    all: (sql, params) => db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[],
  };
}

let db: DatabaseSync;
let engine: OrmEngine;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  engine = sqliteEngine(db);
  seed(engine, 50, 4);
});

describe('zmdb ORM query set (real SQLite)', () => {
  it('customerById returns the row', () => {
    expect(zmdbQueries.customerById(engine, 1)).toMatchObject({ id: 1, name: 'cust1' });
  });
  it('productsSearch paginates', () => {
    const page = zmdbQueries.productsSearch(engine, 10, 0);
    expect(page).toHaveLength(10);
    expect(page[0]).toMatchObject({ id: 1 });
  });
  it('ordersForCustomer returns that customer orders', () => {
    const orders = zmdbQueries.ordersForCustomer(engine, 1);
    expect(orders).toHaveLength(4);
  });
  it('topProducts aggregates', () => {
    expect(zmdbQueries.topProducts(engine).length).toBeGreaterThan(0);
  });
});

describe('runOrmSuite honesty policy', () => {
  it('emits a schema-valid result for every in-scope case (ok or DNF)', () => {
    const results = runOrmSuite(engine, 20);
    for (const r of results) expect(validateResult(r)).toEqual([]);
    // Full coverage — no in-scope case silently omitted.
    expect(validateCoverage('orm', 'zmdb', results)).toEqual([]);
  });

  it('reports anti-pattern cases as DNF(anti-pattern)', () => {
    const results = runOrmSuite(engine, 20);
    const antiPatterns = ['lazy-relation-graph', 'identity-map-dedup', 'active-record-save'];
    for (const c of antiPatterns) {
      const r = results.find((x) => x.case === c)!;
      expect(r.status).toBe('dnf');
      expect(r.dnfReason).toContain('anti-pattern');
    }
  });

  it('supported cases are ok with ops/sec', () => {
    const supported = IN_SCOPE_CASES.orm.filter(
      (c) => !['lazy-relation-graph', 'identity-map-dedup', 'active-record-save'].includes(c),
    );
    const results = runOrmSuite(engine, 20);
    for (const c of supported) {
      const r = results.find((x) => x.case === c)!;
      expect(r.status).toBe('ok');
      expect(r.opsPerSec).toBeGreaterThan(0);
    }
  });
});

describe('competitor comparison', () => {
  it('reports Drizzle/Prisma/Kysely as DNF(not implemented) — visible, not skipped', () => {
    const results = competitorDnf();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.status).toBe('dnf');
      expect(r.dnfReason).toContain('not implemented');
      expect(validateResult(r)).toEqual([]);
    }
  });
});
