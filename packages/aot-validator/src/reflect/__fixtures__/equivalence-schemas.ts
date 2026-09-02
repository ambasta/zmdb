// The `defineSchema` half of the equivalence corpus. `equivalence.ts` is the other.
//
// Every table here must describe exactly what its tagged twin describes, column for
// column and constraint for constraint. `reflect.spec.ts` asserts the two `SchemaIR`s
// are deep-equal and that the table-name sets match, so a divergence is a failure
// rather than a gap.
//
// This half is a real module — the spec imports it at runtime — which is why it is
// separate from the tagged half, whose `pair<T>()` calls are declarations only.

import {
  bigint,
  boolean,
  defineSchema,
  integer,
  jsonEnum,
  numeric,
  references,
  serial,
  text,
  timestamp,
  varchar,
} from '@zmdb/schema-core';

export const users = defineSchema(
  'users',
  {
    id: serial().primaryKey(),
    email: varchar(255).unique().validate({ kind: 'pattern', value: '^\\S+@\\S+$' }),
    age: integer().validate({ kind: 'minimum', value: 18 }).validate({ kind: 'maximum', value: 120 }),
    score: numeric(),
    visits: bigint(),
    bio: text().nullable().validate({ kind: 'minLength', value: 3 }).validate({ kind: 'maxLength', value: 2000 }),
    active: boolean(),
    // `defaultTo(undefined)` rather than `defaultTo('now()')`: `HasDefault` records that
    // a default exists, and no type can carry the value. Keeping the value out of the
    // corpus is what lets the equivalence assertion stay a total deep-equality instead
    // of a comparison with an exception carved out of it.
    createdAt: timestamp().defaultTo(undefined),
    // Deliberately unsorted, and in a different order from the twin's union. See the note
    // there: enum order is not a fact either front-end can carry, so the IR canonicalises it.
    role: jsonEnum(['viewer', 'admin', 'editor']),
    passwordHash: text().sensitive(),
  },
  // The one thing on this side that is not a column. `Fts<'users_fts'>` is the twin's
  // spelling, and both land in `SchemaIR.ftsTable`.
  { ftsTable: 'users_fts' },
);

export const memberships = defineSchema('memberships', {
  userId: references(integer().primaryKey(), 'users', 'id'),
  groupId: references(integer().primaryKey(), 'groups', 'id'),
  invitedBy: references(integer().nullable(), 'users', 'id'),
});
