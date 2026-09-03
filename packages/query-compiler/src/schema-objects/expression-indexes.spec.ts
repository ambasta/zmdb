import { describe, it, expect } from 'vitest';

import { UnsupportedFeatureError } from '../errors.js';
import type { Dialect } from '../index.js';
import { createIndexDdl, type IndexDef } from './index.js';

// Expression index columns. Tests freeze for the epic "Composite primary keys and expression
// indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md` §1.1.
//
// `indexes.spec.ts` next door covers the index DDL that exists. This file covers the form that
// does not: an index column that is an *expression* rather than a name, which is what
// `CREATE UNIQUE INDEX … ON users (lower(email))` needs and what
// `docs-site/content/guide-case-insensitive-unique.md` currently sends readers to a
// hand-written migration for.
//
// `it.fails` for every frozen claim, with the current output recorded above it. See
// `../migrations/composite-keys.spec.ts` for why `it.fails` and not `.skip` or a stub.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// §1.1 turns `IndexDef.columns` from `readonly string[]` into `readonly IndexColumn[]`. Neither
// `IndexColumn` nor the widened `IndexDef` exists in `./index.ts`, so the widening — and only
// the widening — is declared here and handed to the real `createIndexDdl` through one
// assertion. Both go away in the slice that widens `IndexDef` for real.

/** §1.1: an index column is a name or an expression, as two different kinds. */
type IndexColumn = string | { readonly expr: string };

type FrozenIndexDef = Omit<IndexDef, 'columns'> & { readonly columns: readonly IndexColumn[] };

/**
 * The real emitter's answer, or the exception it produced, as a string.
 *
 * boundary: `def` is the shape §1.1 freezes and today's `IndexDef` does not admit an object in
 * `columns`; the assertion is what lets this file compile against a surface that is one slice
 * away. The `try` is not defensiveness — it is what makes each `it.fails` below fail on a
 * *comparison*. Handed `{ expr }` today, `createIndexDdl` calls `quoteIdentifier` on the
 * object and dies inside `String.prototype.replaceAll`, and an uncaught `TypeError` prints the
 * library's internals instead of what the emitter produced. Once the feature lands the `try`
 * succeeds and every assertion here is an assertion about DDL.
 */
function ddl(def: FrozenIndexDef, dialect: Dialect): string {
  try {
    return createIndexDdl(def as IndexDef, dialect);
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : `threw ${String(error)}`;
  }
}

const caseInsensitiveEmail: FrozenIndexDef = {
  name: 'users_email_ci',
  table: 'users',
  columns: [{ expr: 'lower(email)' }],
  unique: true,
};

describe('expression index columns (frozen: schema-objects/SPEC.md 1.1)', () => {
  // The expression is emitted verbatim between the parens and is never quoted. `lower(email)`
  // put through `quoteIdentifier` gives `"lower(email)"`, which Postgres reads as a column
  // whose name contains parentheses and rejects with "column does not exist".
  //
  // actual today, both dialects:
  //   TypeError: identifier.replaceAll is not a function
  // — `quoteIdentifier` is handed the `{ expr }` object and calls a string method on it. The
  // recorded actual is the object reaching a function that only ever expected a name, which is
  // the whole argument for the tagged form.
  it.fails('emits a functional unique index without quoting the expression', () => {
    const golden = 'CREATE UNIQUE INDEX "users_email_ci" ON "users" (lower(email))';
    expect(ddl(caseInsensitiveEmail, 'postgres'), 'postgres').toBe(golden);
    // SQLite has had expression indexes since 3.9 and quotes identifiers the same way, so the
    // statement is byte-identical.
    expect(ddl(caseInsensitiveEmail, 'sqlite'), 'sqlite').toBe(golden);
  });

  // Mixed forms are allowed and each element is treated on its own: a name is quoted, an
  // expression is not, in the one statement.
  //
  // actual today: TypeError: identifier.replaceAll is not a function
  it.fails('quotes a name and leaves an expression alone in the same index', () => {
    expect(
      ddl(
        { name: 'users_tenant_email_ci', table: 'users', columns: ['tenant_id', { expr: 'lower(email)' }] },
        'postgres',
      ),
    ).toBe('CREATE INDEX "users_tenant_email_ci" ON "users" ("tenant_id", lower(email))');
  });

  // An expression is opaque. Comparing it as a byte string makes `lower(email)` and
  // `LOWER(email)` two different indexes, and that is deliberate: normalising SQL expressions
  // means parsing three dialects' expression grammars, and a normaliser that is wrong in one
  // direction reports no change for an index that did change.
  //
  // actual today: both calls return `TypeError: identifier.replaceAll is not a function`, so
  // the two spellings are indistinguishable — they produce the *same* string, which is the
  // opposite of the claim.
  it.fails('treats two spellings of the same expression as two indexes', () => {
    const lower = ddl({ ...caseInsensitiveEmail, columns: [{ expr: 'lower(email)' }] }, 'postgres');
    const upper = ddl({ ...caseInsensitiveEmail, columns: [{ expr: 'LOWER(email)' }] }, 'postgres');
    expect(lower).toBe('CREATE UNIQUE INDEX "users_email_ci" ON "users" (lower(email))');
    expect(upper).toBe('CREATE UNIQUE INDEX "users_email_ci" ON "users" (LOWER(email))');
    expect(lower).not.toBe(upper);
  });

  // MySQL 8 supports functional key parts, but only inside a second set of parens —
  // `((lower(email)))` — and not at all before 8.0.13. Emitting the Postgres spelling there is
  // a syntax error at migration time; emitting the MySQL spelling makes one declaration two
  // different indexes depending on the dialect. So it is refused.
  //
  // actual today: TypeError: identifier.replaceAll is not a function — a refusal of a kind, in
  // that no DDL comes out, but not one anybody can act on.
  //
  // The class and the message are both asserted and today they cannot both hold:
  // `UnsupportedFeatureError(feature, dialect)` builds its own text, `<feature> is not
  // supported on dialect "<dialect>"`, and the frozen wording is not of that shape. The
  // implementation slice widens the constructor or the spec gives up the wording; asserting
  // both is what makes that a decision rather than a discovery.
  it.fails('refuses an expression index on mysql, naming the index and the way round it', () => {
    expect(() => createIndexDdl(caseInsensitiveEmail as IndexDef, 'mysql')).toThrow(UnsupportedFeatureError);
    expect(() => createIndexDdl(caseInsensitiveEmail as IndexDef, 'mysql')).toThrow(
      /mysql does not support an expression index \("users_email_ci" on "users" uses lower\(email\)\)/,
    );
    expect(() => createIndexDdl(caseInsensitiveEmail as IndexDef, 'mysql')).toThrow(
      /add a generated column and index that instead/,
    );
  });

  // The half the epic must not break, and it passes today. A bare string is a *name*, even one
  // that looks like an expression, and it goes through `quoteIdentifier` as a name. Sniffing
  // for a `(` to decide would make a legitimately odd column name unindexable while quietly
  // accepting a half-written expression, so the caller says which it meant and this is what
  // "it meant a name" produces.
  it('quotes a bare string as a name even when it looks like an expression', () => {
    expect(createIndexDdl({ name: 'ix', table: 'users', columns: ['lower(email)'] }, 'postgres')).toBe(
      'CREATE INDEX "ix" ON "users" ("lower(email)")',
    );
    expect(createIndexDdl({ name: 'ix', table: 'users', columns: ['lower(email)'] }, 'mysql')).toBe(
      'CREATE INDEX `ix` ON `users` (`lower(email)`)',
    );
  });
});
