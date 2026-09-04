import { describe, it, expect } from 'vitest';

import { UnsupportedFeatureError } from '../errors.js';
import type { Dialect } from '../index.js';
import { createIndexDdl, type IndexDef } from './index.js';

// Expression index columns. Tests freeze for the epic "Composite primary keys and expression
// indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md` §1.1.
//
// `indexes.spec.ts` next door covers ordinary name columns. This file pins the expression form
// implemented by #413, including the case-insensitive unique index documented in
// `docs-site/content/guide-case-insensitive-unique.md`.
//
function ddl(def: IndexDef, dialect: Dialect): string {
  return createIndexDdl(def, dialect);
}

const caseInsensitiveEmail: IndexDef = {
  name: 'users_email_ci',
  table: 'users',
  columns: [{ expr: 'lower(email)' }],
  unique: true,
};

describe('expression index columns (frozen: schema-objects/SPEC.md 1.1)', () => {
  // The expression is emitted verbatim between the parens and is never quoted. `lower(email)`
  // put through `quoteIdentifier` gives `"lower(email)"`, which Postgres reads as a column
  // whose name contains parentheses and rejects with "column does not exist".
  it('emits a functional unique index without quoting the expression', () => {
    const golden = 'CREATE UNIQUE INDEX "users_email_ci" ON "users" (lower(email))';
    expect(ddl(caseInsensitiveEmail, 'postgres'), 'postgres').toBe(golden);
    // SQLite has had expression indexes since 3.9 and quotes identifiers the same way, so the
    // statement is byte-identical.
    expect(ddl(caseInsensitiveEmail, 'sqlite'), 'sqlite').toBe(golden);
  });

  // Mixed forms are allowed and each element is treated on its own: a name is quoted, an
  // expression is not, in the one statement.
  it('quotes a name and leaves an expression alone in the same index', () => {
    const def: IndexDef = {
      name: 'users_tenant_email_ci',
      table: 'users',
      columns: ['tenant_id', { expr: 'lower(email)' }],
    };
    const golden = 'CREATE INDEX "users_tenant_email_ci" ON "users" ("tenant_id", lower(email))';
    expect(ddl(def, 'postgres'), 'postgres').toBe(golden);
    expect(ddl(def, 'sqlite'), 'sqlite').toBe(golden);
  });

  // An expression is opaque. Comparing it as a byte string makes `lower(email)` and
  // `LOWER(email)` two different indexes, and that is deliberate: normalising SQL expressions
  // means parsing three dialects' expression grammars, and a normaliser that is wrong in one
  // direction reports no change for an index that did change.
  it('treats two spellings of the same expression as two indexes', () => {
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
  it('refuses an expression index on mysql, naming the index and the way round it', () => {
    expect(() => createIndexDdl(caseInsensitiveEmail, 'mysql')).toThrow(UnsupportedFeatureError);
    expect(() => createIndexDdl(caseInsensitiveEmail, 'mysql')).toThrow(
      /mysql does not support an expression index \("users_email_ci" on "users" uses lower\(email\)\)/,
    );
    expect(() => createIndexDdl(caseInsensitiveEmail, 'mysql')).toThrow(
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
    expect(createIndexDdl({ name: 'ix', table: 'users', columns: ['lower(email)'] }, 'sqlite')).toBe(
      'CREATE INDEX "ix" ON "users" ("lower(email)")',
    );
  });
});
