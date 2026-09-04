import { describe, it, expect } from 'vitest';

import type { SchemaIR } from '../ir/index.js';
import { compilePopulate, resolveRelation, type ResolvedRelation } from './index.js';

// A relation whose parent key has two columns. Tests freeze for the epic "Composite primary keys
// and expression indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md` §2.1.
//
// `populate.spec.ts` next door covers every relation whose parent key has one column, and none of
// that is repeated here. §2.1 exists because of what happens on a table whose key has two: the
// resolver takes `ir.primaryKey[0]`, joins on half the key, and returns a *superset* of the right
// children — "the worst available failure, because a to-many relation returning too many children
// looks like data rather than like a bug". Every claim below was run against the current resolver
// to capture what it does instead.
//
// `it.fails` for the frozen claims. See `@zmdb/query-compiler`'s
// `src/migrations/composite-keys.spec.ts` for why `it.fails` rather than `.skip` or a stub.

// ---------------------------------------------------------------------------
// Fixtures, as IR
// ---------------------------------------------------------------------------
//
// Written as IR literals rather than added to `./fixtures.ts`, because a tagged interface with a
// two-column key cannot be turned into a schema value today: `schemasFrom` goes through
// `@zmdb/aot-validator`'s reflector, which builds `primaryKey` by filtering the per-column flag
// and refuses a table with none. `resolveRelation` and `compilePopulate` both take `SchemaIR`
// directly, so nothing is lost. The type-level half lives in `composite-parent-key.type-test.ts`,
// where the tagged form costs nothing because it is never evaluated.

const column = (name: string, extra: Partial<SchemaIR['columns'][number]> = {}): SchemaIR['columns'][number] => ({
  name,
  physicalName: name,
  sql: 'integer',
  nullable: false,
  primaryKey: false,
  serial: false,
  unique: false,
  hasDefault: false,
  sensitive: false,
  constraints: {},
  rules: [],
  ...extra,
});

/** Keyed `(tenantId, id)` — two columns, in that declaration order. */
const users: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [
    column('tenantId', { sql: 'text', primaryKey: true }),
    column('id', { primaryKey: true }),
    column('email', { sql: 'text' }),
  ],
  primaryKey: ['tenantId', 'id'],
  relations: [
    // The declaration §2.1 quotes: one target column against a two-column key.
    { name: 'posts', relation: 'oneToMany', target: 'posts', via: 'userId' },
    // The same relation written the way the diagnostic tells the author to write it.
    { name: 'postsBoth', relation: 'oneToMany', target: 'posts', via: 'tenantId,userId' },
    // The inverse one-to-one takes the same path, so it has the same defect.
    { name: 'profile', relation: 'oneToOne', target: 'profiles', via: 'userId' },
  ],
};

/** The owning side. `(tenantId, userId)` together point at `users`' two key columns. */
const posts: SchemaIR = {
  table: 'posts',
  physicalTable: 'posts',
  columns: [
    column('id', { primaryKey: true }),
    column('tenantId', { sql: 'text', references: 'users.tenantId' }),
    column('userId', { references: 'users.id' }),
    column('noRef'),
  ],
  primaryKey: ['id'],
  relations: [
    { name: 'authorBoth', relation: 'manyToOne', target: 'users', via: 'tenantId,userId' },
    // Two columns, one `References`. §2.1 refuses this rather than defaulting the other to `id`.
    { name: 'authorHalf', relation: 'manyToOne', target: 'users', via: 'tenantId,noRef' },
  ],
};

/**
 * The resolver's answer under the shape §2.1 freezes.
 *
 * boundary: `ResolvedRelation.parentKey` and `.targetKey` are `string` today and `readonly
 * string[]` in §2.1. The assertion is what lets this file compile against a surface that is one
 * slice away; it deletes itself with the widening. The recorded actual above each test is what
 * the real resolver returned, so the assertion never hides a wrong answer — it only lets one be
 * compared against the frozen one.
 */
type FrozenRelation = Omit<ResolvedRelation, 'parentKey' | 'targetKey'> & {
  readonly parentKey: readonly string[];
  readonly targetKey: readonly string[];
};

const resolved = (ir: SchemaIR, name: string): FrozenRelation => resolveRelation(ir, name) as unknown as FrozenRelation;

describe('resolving a composite parent key (frozen: relations/SPEC.md 2.1)', () => {
  // The inverse side takes the *whole* `ir.primaryKey`, in declaration order.
  //
  // actual today:
  //   {"name":"postsBoth","targetTable":"posts","parentKey":"tenantId","targetKey":"tenantId,userId","toMany":true}
  // — `parentKey` is `primaryKey[0]`, and `targetKey` is the `via` string unsplit, so the comma is
  // inside what will be quoted as one identifier.
  it.fails('takes the whole parent key on the inverse side, in declaration order', () => {
    expect(resolved(users, 'postsBoth')).toEqual({
      name: 'postsBoth',
      targetTable: 'posts',
      parentKey: ['tenantId', 'id'],
      targetKey: ['tenantId', 'userId'],
      toMany: true,
    });
  });

  // Positional pairing, stated as a claim rather than left implicit: `parentKey[i]` joins
  // `targetKey[i]`. Nothing here matches by name, and this fixture is the reason — `users.id`
  // pairs with `posts.userId`, which share no part of a name, while `tenantId` appears on both
  // sides. A resolver that matched by name would pair `tenantId` with `tenantId` and then have
  // `id` and `userId` left over, and get the right answer for the wrong reason.
  //
  // actual today: parentKey is the string "tenantId", so it has no positions at all.
  it.fails('pairs the two lists positionally, not by name', () => {
    const rel = resolved(users, 'postsBoth');
    expect(rel.parentKey.length).toBe(rel.targetKey.length);
    expect([...rel.parentKey.keys()].map(i => [rel.parentKey[i], rel.targetKey[i]])).toEqual([
      ['tenantId', 'tenantId'],
      ['id', 'userId'],
    ]);
  });

  // The owning side splits `via` on `,` in written order, and each column's own `References`
  // supplies its partner.
  //
  // actual today:
  //   {"name":"authorBoth","targetTable":"users","parentKey":"tenantId,userId","targetKey":"id","toMany":false}
  // — `parentKey` unsplit, and `targetKey` is `"id"` because `referencedColumn` looked for a
  // column literally named `tenantId,userId`, found none, and fell back to `'id'`.
  it.fails('splits via on a comma on the owning side and reads each References', () => {
    expect(resolved(posts, 'authorBoth')).toEqual({
      name: 'authorBoth',
      targetTable: 'users',
      parentKey: ['tenantId', 'userId'],
      targetKey: ['tenantId', 'id'],
      toMany: false,
    });
  });

  // §2.1: "A relation whose `via` names two columns where only one carries a `References` is
  // refused rather than defaulted to `id`." The `'id'` default is a guess that is right often
  // enough to be load-bearing and wrong silently.
  //
  // actual today: no throw. It returns
  //   {"name":"authorHalf","targetTable":"users","parentKey":"tenantId,noRef","targetKey":"id","toMany":false}
  // and the join it produces matches `users.id` against a column that references nothing.
  it.fails('refuses a via column that carries no References instead of defaulting to id', () => {
    expect(() => resolveRelation(posts, 'authorHalf')).toThrow(/noRef/);
    expect(() => resolveRelation(posts, 'authorHalf')).toThrow(/References/);
  });

  // A one-column key still resolves, to a one-element list — one code path, not a general one and
  // a fast one. `posts` is keyed `(id)`, so its inverse relations are the ordinary case.
  //
  // actual today: parentKey is the bare string "id", so this is the widening restated at the
  // simplest possible shape; it is here because "a single-column key resolves to a one-element
  // list" is the sentence in §2.1 that keeps the implementation from branching.
  it.fails('resolves a one-column key to a one-element list', () => {
    const single: SchemaIR = {
      ...posts,
      relations: [{ name: 'comments', relation: 'oneToMany', target: 'comments', via: 'postId' }],
    };
    expect(resolved(single, 'comments').parentKey).toEqual(['id']);
    expect(resolved(single, 'comments').targetKey).toEqual(['postId']);
  });
});

describe('the length check (frozen: relations/SPEC.md 2.1)', () => {
  // The diagnostic §2.1 quotes, at derivation rather than at query time — because the query it
  // would otherwise build is valid SQL that returns a superset, and nothing downstream can tell.
  //
  // The message is matched in ASCII-only fragments: the frozen text contains an em dash, and
  // pinning punctuation would make an editorial change to the wording a test failure while the
  // three load-bearing facts (the count, the key in order, and the spelling that fixes it) are
  // what a reader needs.
  //
  // actual today: no throw whatsoever. `resolveRelation(users, 'posts')` returns
  //   {"name":"posts","targetTable":"posts","parentKey":"tenantId","targetKey":"userId","toMany":true}
  // — a join on `users.tenantId = posts.userId`, which is two unrelated columns of compatible
  // type. Every post of every user in the tenant comes back as that user's.
  it.fails('refuses one target column against a two-column parent key, naming the key order', () => {
    expect(() => resolveRelation(users, 'posts')).toThrow(
      /users\.posts: OneToMany<'posts', 'userId'> supplies 1 target column for a 2-column parent key/,
    );
    expect(() => resolveRelation(users, 'posts')).toThrow(/\(tenantId, id\)/);
    expect(() => resolveRelation(users, 'posts')).toThrow(/name every column, in key order/);
    expect(() => resolveRelation(users, 'posts')).toThrow(/OneToMany<'posts', 'tenantId,userId'>/);
  });

  // The inverse one-to-one is the same branch and gets the same refusal. It is asserted
  // separately because it is a different `if` in the resolver and the cardinality in the message
  // has to follow the declaration.
  //
  // actual today: no throw; returns parentKey "tenantId", targetKey "userId".
  it.fails('refuses the same mismatch on an inverse one-to-one', () => {
    expect(() => resolveRelation(users, 'profile')).toThrow(/users\.profile: OneToOne<'profiles', 'userId'>/);
    expect(() => resolveRelation(users, 'profile')).toThrow(/1 target column for a 2-column parent key/);
  });

  // `ManyToMany` still throws, for the reason it already did — two hops are not one `IN`. Green
  // today and §2.1 keeps it, so it is pinned here against a rewrite that makes every relation go
  // through the new length check and loses the more specific message.
  it('still refuses many-to-many for its own reason', () => {
    const withM2M: SchemaIR = {
      ...users,
      relations: [{ name: 'tags', relation: 'manyToMany', target: 'tags', via: 'user_tags' }],
    };
    expect(() => resolveRelation(withM2M, 'tags')).toThrow(/many-to-many through "user_tags"/);
    expect(() => resolveRelation(withM2M, 'tags')).toThrow(/join the two tables explicitly/);
  });
});

describe('populate over a composite key (frozen: relations/SPEC.md 2.1)', () => {
  // A to-one conjoins the pairs in the `ON` clause.
  //
  // actual today:
  //   SELECT * FROM "posts" INNER JOIN "users" ON "posts"."tenantId,userId" = "users"."id"
  // — one equality, and its left side is a quoted identifier with a comma in it, which no dialect
  // has a column named.
  it.fails('conjoins every pair in the ON clause of a to-one join', () => {
    expect(compilePopulate(posts, 'authorBoth', 'postgres')).toEqual({
      kind: 'join',
      sql:
        'SELECT * FROM "posts" INNER JOIN "users" ON "posts"."tenantId" = "users"."tenantId" ' +
        'AND "posts"."userId" = "users"."id"',
      parameters: [],
    });
  });

  // A to-many's batched lookup becomes a tuple `IN`. One statement per relation per batch, the
  // same as the single-column form, rather than an `OR` of conjunctions that grows with the batch.
  //
  // actual today, with the same two tuples:
  //   SELECT * FROM "posts" WHERE "userId" IN ($1, $2)
  //   parameters [["t1",1],["t1",2]]
  // — the arrays are passed as two *scalar* parameters, so a driver either rejects them or
  // compares a column against an array.
  it.fails('emits a tuple IN for a batched to-many lookup on postgres', () => {
    expect(
      compilePopulate(users, 'postsBoth', 'postgres', [
        ['t1', 1],
        ['t1', 2],
      ]),
    ).toEqual({
      kind: 'batched',
      sql: 'SELECT * FROM "posts" WHERE ("tenantId", "userId") IN (($1, $2), ($3, $4))',
      parameters: ['t1', 1, 't1', 2],
    });
  });

  // MySQL and SQLite take the same form with their own placeholder. SQLite has had row values
  // since 3.15, which `node:sqlite` is well past, so there is no third spelling.
  //
  // actual today:
  //   mysql   SELECT * FROM `posts` WHERE `userId` IN (?)      parameters [["t1",1]]
  //   sqlite  SELECT * FROM "posts" WHERE "userId" IN (?)      parameters [["t1",1]]
  it.fails('emits the same tuple IN on mysql and sqlite', () => {
    expect(compilePopulate(users, 'postsBoth', 'mysql', [['t1', 1]]).sql).toBe(
      'SELECT * FROM `posts` WHERE (`tenantId`, `userId`) IN ((?, ?))',
    );
    expect(compilePopulate(users, 'postsBoth', 'sqlite', [['t1', 1]]).sql).toBe(
      'SELECT * FROM "posts" WHERE ("tenantId", "userId") IN ((?, ?))',
    );
  });

  // No parent keys is still `WHERE 1 = 0` — not an empty `IN ()`, which is a syntax error on
  // MySQL, and not a skipped query, which would leave the relation unset rather than empty. Green
  // today and §2.1 keeps it verbatim.
  it('still emits WHERE 1 = 0 for an empty batch', () => {
    expect(compilePopulate(users, 'postsBoth', 'postgres', [])).toEqual({
      kind: 'batched',
      sql: 'SELECT * FROM "posts" WHERE 1 = 0',
      parameters: [],
    });
  });
});
