// The old spelling of the two tables `tables.ts` declares by hand.
//
// This is the codemod's hardest test and the cheapest one to read: the answer is already in
// the repository. `tables.ts` was written by a person, is reflected into the golden `SchemaIR`
// in `reflect.spec.ts` and is what four back-end specs are checked against — so if the
// codemod converts this file into those same property lines, it inherits all of that rather
// than restating any of it.
//
// It pins two things no IR comparison can see, which is why the assertion is on the emitted
// text: the order the tags come out in, and the `(T & Tags) | null` bracketing that keeps
// `null & Unique` from reducing to `never` and silently dropping the nullability.
//
// The DSL comes from `./legacy-dsl.ts`, declared and not implemented — see that file. Nothing
// imports this at runtime, and nothing could.

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
} from './legacy-dsl.js';

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
    // `defaultTo(undefined)` rather than `defaultTo('now()')`, so this table exercises the
    // conversion without also exercising the dropped-value report. `codemod-corpus.ts` is
    // where a real default value lives.
    createdAt: timestamp().defaultTo(undefined),
    // Deliberately unsorted, and in a different order from the interface's union. Enum order
    // is not a fact the IR carries — it canonicalises — but it is a fact the *source* carries,
    // and the codemod has no business reordering source it is only re-spelling.
    role: jsonEnum(['viewer', 'admin', 'editor']),
    passwordHash: text().sensitive(),
  },
  // The one thing here that is not a column. `Fts<'users_fts'>` is the interface's spelling of
  // it, and both land in `SchemaIR.ftsTable`.
  { ftsTable: 'users_fts' },
);

export const memberships = defineSchema('memberships', {
  userId: references(integer().primaryKey(), 'users', 'id'),
  groupId: references(integer().primaryKey(), 'groups', 'id'),
  invitedBy: references(integer().nullable(), 'users', 'id'),
});
