// Compile-only freeze for query-compiler/SPEC.md §5b and repository/SPEC.md §3b.
//
// The missing-export directives pin the public names without `declare const`.
// The implemented local surface below pins the accepted generic rules and becomes
// unnecessary when #444/#445 export the real types and constructors.

import type {
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  ColumnExpr,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  EXPR,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  SetValue,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  coalesce,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  concat,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  dec,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  inc,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  mul,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  not,
  // @ts-expect-error TS2305 — frozen by query-compiler/SPEC.md §5b; not exported yet.
  proposed,
} from '@zmdb/query-compiler';
import type { CreateDTO, DeclaredTable, Equal, Expect, UpdateDTO } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

export type _missing_public_expression_surface = [
  typeof EXPR,
  ColumnExpr<number>,
  SetValue<number>,
  typeof inc,
  typeof dec,
  typeof mul,
  typeof not,
  typeof concat,
  typeof coalesce,
  typeof proposed,
];

const FROZEN_EXPR: unique symbol = Symbol('zmdb.tests.expression');
const FROZEN_PHANTOM: unique symbol = Symbol('zmdb.tests.expression.phantom');

type FrozenColumnExpr<T> = {
  readonly [FROZEN_EXPR]: true;
  readonly [FROZEN_PHANTOM]?: T;
} & (
  | { readonly op: 'add' | 'sub' | 'mul'; readonly by: T }
  | { readonly op: 'not' }
  | { readonly op: 'concat'; readonly with: string }
  | { readonly op: 'coalesce'; readonly fallback: T }
  | { readonly op: 'proposed' }
);

type FrozenSetValue<T> = T | FrozenColumnExpr<T>;

type FrozenInc = <T extends number | bigint>(by?: T) => FrozenColumnExpr<T>;
type FrozenDec = <T extends number | bigint>(by?: T) => FrozenColumnExpr<T>;
type FrozenMul = <T extends number>(by: T) => FrozenColumnExpr<T>;
type FrozenNot = () => FrozenColumnExpr<boolean>;
type FrozenConcat = (withText: string) => FrozenColumnExpr<string>;
type FrozenCoalesce = <T>(fallback: T) => FrozenColumnExpr<T>;
type FrozenProposed = <T>() => FrozenColumnExpr<T>;

function unimplemented(name: string): never {
  throw new Error(`${name} is a compile-only frozen surface`);
}

const frozenInc: FrozenInc = _by => unimplemented('inc');
const frozenDec: FrozenDec = _by => unimplemented('dec');
const frozenMul: FrozenMul = _by => unimplemented('mul');
const frozenNot: FrozenNot = () => unimplemented('not');
const frozenConcat: FrozenConcat = _withText => unimplemented('concat');
const frozenCoalesce: FrozenCoalesce = _fallback => unimplemented('coalesce');
const frozenProposed: FrozenProposed = () => unimplemented('proposed');

interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  views: number & Sql<'integer'>;
  total: bigint & Sql<'bigint'>;
  ratio: number & Sql<'numeric'>;
  published: boolean & Sql<'boolean'>;
  title: string & Sql<'text'>;
  nickname: (string & Sql<'text'>) | null;
}

type FrozenUpdatePatch<T extends DeclaredTable> = {
  readonly [K in keyof UpdateDTO<T>]?: FrozenSetValue<UpdateDTO<T>[K]>;
};

function acceptUpdate(_patch: FrozenUpdatePatch<Post>): void {}
function acceptCreate(_payload: CreateDTO<Post>): void {}

acceptUpdate({
  views: frozenInc(1),
  total: frozenDec(1n),
  ratio: frozenMul(2),
  published: frozenNot(),
  title: frozenConcat(' (draft)'),
  nickname: frozenCoalesce('anonymous'),
});
acceptUpdate({ views: frozenInc(), total: frozenDec() });
acceptUpdate({ views: 1, total: 1n, published: false, title: 'plain', nickname: null });

// @ts-expect-error not() is boolean-only; views is a number.
acceptUpdate({ views: frozenNot() });
// @ts-expect-error inc() is numeric; published is a boolean.
acceptUpdate({ published: frozenInc(1) });
// @ts-expect-error a bigint column requires a bigint arithmetic operand.
acceptUpdate({ total: frozenInc(1) });
// @ts-expect-error a number column requires a number arithmetic operand.
acceptUpdate({ views: frozenDec(1n) });
// @ts-expect-error concat() is string-only; views is a number.
acceptUpdate({ views: frozenConcat('1') });
// @ts-expect-error coalesce fallback must be the column's value type.
acceptUpdate({ views: frozenCoalesce('zero') });
// @ts-expect-error mul() deliberately excludes bigint because multiplication can exceed exact JS number range.
frozenMul(2n);
// @ts-expect-error primary keys identify the row and are absent from UpdateDTO.
acceptUpdate({ id: frozenInc(1) });
acceptCreate({
  // @ts-expect-error create accepts values, not expressions.
  views: frozenInc(1),
  total: 1n,
  ratio: 1,
  published: false,
  title: 'draft',
  nickname: null,
});

// The accepted surface cannot make this a compile error: `proposed` is a member
// of `ColumnExpr<T>`, and `SetValue<T>` admits every ColumnExpr<T>. Runtime context
// rejection is frozen in expressions.spec.ts; a compile-time rejection needs a
// distinct update/upsert expression type that the accepted SPEC does not define.
acceptUpdate({ views: frozenProposed<number>() });
export type _accepted_set_value_admits_proposed = Expect<
  Equal<FrozenColumnExpr<number> extends FrozenSetValue<number> ? true : false, true>
>;
