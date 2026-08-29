import { describe, it, expect } from 'vitest';
import { Kysely, DummyDriver, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { createQueryCompiler } from '@zmdb/query-compiler';

// #20: zero-overhead query-compilation benchmark vs Kysely.
// Both compile the SAME query to parameterized SQL WITHOUT a live DB; we assert
// equivalence of the compiled output and expose an ops/sec micro-benchmark.
// (Speed ordering is reported, not asserted — timing is environment-dependent.)

declare const performance: { now(): number };

interface DB {
  users: { id: number; email: string; role: string };
}

// Compiler-only Kysely (DummyDriver so .compile() works offline).
const k = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

function bench(fn: () => void, iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = performance.now() - start;
  return ms > 0 ? Math.round((iterations / ms) * 1000) : iterations;
}

describe('query compilation vs Kysely', () => {
  it('both compile a SELECT to equivalent parameterized SQL', () => {
    const zmdb = createQueryCompiler('postgres')
      .selectFrom('users')
      .where('email', '=', 'a@b.com')
      .compile();
    const kc = k.selectFrom('users').selectAll().where('email', '=', 'a@b.com').compile();

    // Same parameters and same essential SQL shape.
    expect(zmdb.parameters).toEqual(['a@b.com']);
    expect(kc.parameters).toEqual(['a@b.com']);
    expect(zmdb.text).toBe('SELECT * FROM "users" WHERE "email" = $1');
    // Kysely selectAll → "select * from ..." (lowercased keywords); assert it
    // is a parameterized select over the same table/column.
    expect(kc.sql.toLowerCase()).toContain('from "users"');
    expect(kc.sql).toContain('$1');
  });

  it('exposes ops/sec for both compilers', () => {
    const zmdbOps = bench(
      () => void createQueryCompiler('postgres').selectFrom('users').where('email', '=', 'a@b.com').compile(),
      2000,
    );
    const kyselyOps = bench(
      () => void k.selectFrom('users').selectAll().where('email', '=', 'a@b.com').compile(),
      2000,
    );
    expect(zmdbOps).toBeGreaterThan(0);
    expect(kyselyOps).toBeGreaterThan(0);
    // Reported only — no speed assertion.
  });
});
