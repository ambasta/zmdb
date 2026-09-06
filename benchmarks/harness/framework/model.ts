// The one definition of a `User` in this benchmark, and the validator compiled from it.
//
// It lives beside `app.ts` rather than in it for one reason: `app.ts` imports
// `packages/web/dist`, which is gitignored build output, so no compiler can be pointed at it
// in a fresh checkout — and the codegen needs a compiler. This file imports nothing but zmdb
// sources, so `tsconfig.json` next door can hold it and `@zmdb/compiler` can read it.
//
// `assertUserCreate` below is written as a call with a type argument and nothing else. The
// codegen replaces it with a call into `model.zmdb.generated.js`, which is straight-line
// JavaScript for exactly this shape — no descriptor, no walker, no schema value. That is the
// path a user of zmdb gets and therefore the one the published number should describe; it
// replaces a boot-time `objectTypeFromIR(...)` descriptor handed to a runtime walk, which was
// the fastest thing available before a type could be compiled.
//
// Regenerate with:
//   node --import ./scripts/ts-specifier-hook.mjs scripts/compiler-codegen.mjs --project benchmarks/harness/framework/tsconfig.json
// The generated files are committed, which is what lets `run.sh` bundle this with esbuild and
// no zmdb tool in the loop at all.

import type { CreateDTO } from '../../../packages/schema-core/src/derive/index.js';
import type { PrimaryKey, Serial, Sql, Table } from '../../../packages/schema-core/src/tags/index.js';
import { zmdbAssertUserCreate } from './model.zmdb.generated.js';

/**
 * The shape, once. `Serial` is why `UserCreate` has no `id`: the database generates it, so a
 * caller cannot supply one — the same reason the DDL says `SERIAL PRIMARY KEY`.
 */
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  email: string & Sql<'text'>;
}

/** What a POST /user body has to be. Derived, not declared. */
export type UserCreate = CreateDTO<User>;

/** Throws a `ValidationError` on anything that is not a `UserCreate`. */
export function assertUserCreate(raw: unknown): UserCreate {
  return zmdbAssertUserCreate(raw);
}
