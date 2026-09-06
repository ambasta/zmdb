import { postgres } from '@zmdb/postgres';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { Kysely, DummyDriver, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { describe, it, expect } from 'vitest';

// #20: zero-overhead query compilation vs Kysely.
// Both compile the SAME query to parameterized SQL WITHOUT a live DB, and this
// asserts the two outputs are equivalent — the property that makes the
// comparison meaningful at all.
//
// The ops/sec half of this file used to live here too, asserting only that both
// numbers were greater than zero. That is not a measurement: it ran on whatever
// machine CI gave us and could not fail. The head-to-head throughput comparison
// is `yarn bench`, run locally, and its numbers are committed under
// benchmarks/site/.

interface DB {
  users: { id: number; email: string; role: string };
}

// Compiler-only Kysely (DummyDriver so .compile() works offline).
const k = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: db => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

describe('query compilation vs Kysely', () => {
  it('both compile a SELECT to equivalent parameterized SQL', () => {
    const zmdb = createQueryCompiler(postgres).selectFrom('users').where('email', '=', 'a@b.com').compile();
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
});
