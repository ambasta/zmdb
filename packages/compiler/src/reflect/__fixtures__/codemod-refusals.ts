// Schemas the codemod must refuse, and refuse *by name*.
//
// Every one of these compiles, which is the point: a converter that guesses does not fail
// loudly, it emits a plausible interface. `codemod.spec.ts` asserts each of these produces a
// refusal naming what it could not read, because "refuses rather than guesses" is the
// codemod's whole safety argument and an untested claim is a wish.
//
// The DSL comes from `./legacy-dsl.ts`, which declares it without implementing it — see that
// file. Nothing imports this one at runtime, and nothing could.

import { defineSchema, integer, serial, type Column } from './legacy-dsl.js';

/** A column built by something outside the DSL. Its flags are not readable from syntax. */
declare function opaqueColumn(): Column<'integer', { nullable: false }>;

const table = 'dynamic';

/** The table name is not a literal at the call site, so there is nothing to put in `Table<>`. */
export const dynamic = defineSchema(table, {
  id: serial().primaryKey(),
});

/** A column the interpreter has no rule for. Guessing `integer` would be guessing. */
export const opaque = defineSchema('opaque', {
  id: serial().primaryKey(),
  weight: opaqueColumn(),
});

/** `Colliding` is already a type in this file, so the derived name is not available. */
export interface Colliding {
  id: number;
}

export const collidingSchema = defineSchema('colliding', {
  id: serial().primaryKey(),
  count: integer(),
});
