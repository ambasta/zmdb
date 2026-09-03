// `IndexColumn`, as a type. Tests freeze for the epic "Composite primary keys and expression
// indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md` §1.1.
//
// The type-level half of `expression-indexes.spec.ts`. `node scripts/typecheck.mjs` compiles
// this file, so a frozen claim written plainly is a build failure rather than a red test;
// `@ts-expect-error` over the claim is the `it.fails` of the type level. Each directive absorbs
// exactly one of today's errors and reports TS2578 the day the claim comes true, so the
// implementation slice cannot land without editing this file. See
// `../migrations/composite-keys.type-test.ts` for the placement rule.
import type { Equal, Expect, Extends } from '@zmdb/schema-core';

// One import statement, not two: `import/no-duplicates` is an error in `.oxlintrc.json` and
// `respectEslintDisableDirectives` is false there, so a second `from './index.js'` cannot be
// written and cannot be excused. The directive therefore covers the whole line — which is worth
// knowing, because it would also absorb a future error about `IndexDef` on the same line.
//
// @ts-expect-error frozen (SPEC.md 1.1): `IndexColumn` is exported from this module.
import type { IndexColumn, IndexDef } from './index.js';

/**
 * §1.1 verbatim. Held locally as well as imported because the import above resolves to an error
 * type today, and an error type satisfies any `Equal` the compiler is asked for — so the two
 * assertions are testing different things: the import tests the *name*, and this tests the
 * *shape* it has to have.
 */
type FrozenIndexColumn = string | { readonly expr: string };

// The imported name has the frozen shape. Two directives retire together here: while
// `IndexColumn` does not exist the import is TS2305 and this comparison is `false`, and the
// slice that adds the export clears both at once.
//
// @ts-expect-error frozen (SPEC.md 1.1): the absorbed import is an error type, so this is false today.
export type _IndexColumnShape = Expect<Equal<IndexColumn, FrozenIndexColumn>>;

// `readonly`, not mutable, and `{ readonly expr: string }` rather than a bare string with a
// sigil: the two arms are distinguishable by `typeof c === 'string'`, which is what lets the
// emitter quote one and not the other without ever parsing SQL.
//
// @ts-expect-error frozen (SPEC.md 1.1): `IndexDef.columns` widens to a list of `IndexColumn`.
export type _ColumnsWiden = Expect<Equal<IndexDef['columns'], readonly FrozenIndexColumn[]>>;

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
