// `IndexColumn`, as a type. Tests freeze for the epic "Composite primary keys and expression
// indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md` §1.1.
//
// The type-level half of `expression-indexes.spec.ts`. `node scripts/typecheck.mjs` compiles
// this file and pins the public surface exported from the schema-objects subpath.
import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { IndexColumn, IndexDef, IndexMethod } from './index.js';

/** §1.1 plus §1.2's operator-class carriage. */
type FrozenIndexColumn =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

export type _IndexColumnShape = Expect<Equal<IndexColumn, FrozenIndexColumn>>;

// `readonly`, not mutable, and tagged object arms rather than a bare string with a sigil:
// the emitter can quote a column name and preserve an expression without parsing SQL.
export type _ColumnsWiden = Expect<Equal<IndexDef['columns'], readonly FrozenIndexColumn[]>>;
export type _IndexMethodsClosed = Expect<
  Equal<IndexMethod, 'btree' | 'hash' | 'gin' | 'gist' | 'brin' | 'ivfflat' | 'hnsw'>
>;
export type _MethodOptional = Expect<Equal<IndexDef['method'], IndexMethod | undefined>>;
export type _OptionsOptional = Expect<Equal<IndexDef['with'], Readonly<Record<string, number>> | undefined>>;

// The compatibility claim, and it holds today — which is the reason to write it. Every existing
// caller passes `readonly string[]`, and widening a union arm in is source-compatible, so
// `indexes.spec.ts`, `tagged-to-ddl.spec.ts` and every `IndexDef` literal in the repository keep
// compiling. If the widening is done as a *replacement* — `columns: readonly { expr: string }[]`
// with names spelled some other way — this is the assertion that goes red.
export type _NamesStillFit = Expect<Extends<readonly string[], IndexDef['columns']>>;

// The rest of `IndexDef` does not move. `where` stays a raw SQL string and stays optional, so a
// partial expression index is one declaration and not a new shape.
export type _WhereUnchanged = Expect<Equal<IndexDef['where'], string | undefined>>;
export type _UniqueUnchanged = Expect<Equal<IndexDef['unique'], boolean | undefined>>;
