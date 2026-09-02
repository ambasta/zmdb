// The codemod's round-trip corpus: `defineSchema` calls that between them use every
// construct `scripts/codemod-tagged-schema.mjs` claims to understand.
//
// `codemod.spec.ts` converts this file, compiles the interfaces that come out and reflects
// them back to `SchemaIR`, then compares against `irFromSchema` of the values below. So a
// construct listed here is a construct the codemod is *proved* to convert, and a construct
// missing from here is one nothing checks.
//
// It is separate from `equivalence-schemas.ts` on purpose. That corpus is deliberately
// restricted to what BOTH front-ends can express, so its deep-equality assertion can stay
// total. This one goes the other way: it reaches for the corners — `sensitive(false)`, an
// aliased import, a foreign key named by schema *value*, an `ftsTable` — because those are
// where a converter guesses, and a guess is what the round trip is looking for.
//
// Two fields cannot survive the trip and the spec drops exactly those two:
//
//   - `default`. `defaultTo('now()')` keeps the value at runtime; `HasDefault` records only
//     that a default exists. No type carries a value.
//   - `payload`. `json<Attachment>()` erases its phantom parameter, so `irFromSchema` has
//     nothing to read — the tagged side is *richer* here, not different.

import {
  bigint,
  boolean,
  defineSchema,
  integer,
  json,
  jsonEnum,
  notNull,
  numeric,
  primaryKey,
  references as fk,
  serial,
  text as textColumn,
  timestamp,
  varchar,
} from '@zmdb/schema-core';

/** The payload of the `json` column below. Erased at runtime; recovered from the type. */
export interface Attachment {
  name: string;
  bytes: number;
}

export const accounts = defineSchema('accounts', {
  id: serial().primaryKey(),
  // `varchar` length, and two flags in one chain.
  handle: varchar(64).notNull().unique(),
  // A literal union is how an enum is declared, so no `Sql` tag comes out of this.
  tier: jsonEnum(['free', 'pro', 'enterprise']),
  // An enum that also carries a tag, which is the case that needs bracketing: `&` binds
  // tighter than `|`, so `'monthly' | 'yearly' & HasDefault` means
  // `'monthly' | ('yearly' & HasDefault)`. It compiles, and it is wrong. The corpus went
  // without this for a while and the round trip passed the whole time.
  plan: jsonEnum(['monthly', 'yearly']).defaultTo('monthly'),
  // The same, and nullable, so the brackets have to nest correctly too.
  region: jsonEnum(['eu', 'us']).nullable().unique(),
  balance: numeric(),
  visits: bigint(),
  verified: boolean(),
  // Nullable, so the tags go *inside* the parentheses and `| null` outside.
  note: textColumn().nullable(),
  // Explicitly not sensitive. `sensitive(false)` must not pick up the tag.
  publicBio: textColumn().sensitive(false),
  secret: textColumn().sensitive(),
  // The value is dropped; the flag is not.
  createdAt: timestamp().defaultTo('now()'),
});

/** Function-style modifiers, an aliased `references`, and a `json` payload. */
export const uploads = defineSchema(
  'uploads',
  {
    id: primaryKey(serial()),
    label: notNull(textColumn()),
    // The target is a schema *value* declared in this file, not a string.
    accountId: fk(integer(), accounts, 'id'),
    // A string target with no column, which stores the bare table name.
    reviewedBy: fk(integer().nullable(), 'accounts'),
    meta: json<Attachment>(),
    // A union payload, for the same bracketing reason as `plan` above — the phantom type
    // argument is copied through verbatim, so whatever is in it has to survive being
    // intersected with `Sql<'json'>`.
    variant: json<Attachment | string>(),
  },
  { ftsTable: 'uploads_fts' },
);

/** A composite primary key, and the `ftsTable: true` spelling. */
export const auditEntries = defineSchema(
  'audit_entries',
  {
    accountId: integer().primaryKey(),
    seq: integer().primaryKey(),
    action: jsonEnum(['create', 'update', 'delete']),
    detail: textColumn().validate({ kind: 'maxLength', value: 500 }),
    weight: integer().validate({ kind: 'minimum', value: 0 }).validate({ kind: 'maximum', value: 100 }),
    slug: varchar(32).validate({ kind: 'pattern', value: '^[a-z-]+$' }),
  },
  { ftsTable: true },
);
