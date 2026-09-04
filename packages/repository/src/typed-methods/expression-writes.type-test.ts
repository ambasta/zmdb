import {
  coalesce,
  concat,
  dec,
  inc,
  mul,
  not,
  proposed,
  type ColumnExpr,
  type EXPR,
  type SetValue,
} from '@zmdb/query-compiler';
import type { CreateDTO, DeclaredTable, Equal, Expect, UpdateDTO } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

export type _public_expression_surface = [
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
  readonly [K in keyof UpdateDTO<T>]?: SetValue<UpdateDTO<T>[K]>;
};

function acceptUpdate(_patch: FrozenUpdatePatch<Post>): void {}
function acceptCreate(_payload: CreateDTO<Post>): void {}

acceptUpdate({
  views: inc(1),
  total: dec(1n),
  ratio: mul(2),
  published: not(),
  title: concat(' (draft)'),
  nickname: coalesce('anonymous'),
});
acceptUpdate({ views: inc(), total: dec() });
acceptUpdate({ views: 1, total: 1n, published: false, title: 'plain', nickname: null });

// @ts-expect-error not() is boolean-only; views is a number.
acceptUpdate({ views: not() });
// @ts-expect-error inc() is numeric; published is a boolean.
acceptUpdate({ published: inc(1) });
// @ts-expect-error a bigint column requires a bigint arithmetic operand.
acceptUpdate({ total: inc(1) });
// @ts-expect-error a number column requires a number arithmetic operand.
acceptUpdate({ views: dec(1n) });
// @ts-expect-error concat() is string-only; views is a number.
acceptUpdate({ views: concat('1') });
// @ts-expect-error coalesce fallback must be the column's value type.
acceptUpdate({ views: coalesce('zero') });
// @ts-expect-error mul() deliberately excludes bigint because multiplication can exceed exact JS number range.
mul(2n);
// @ts-expect-error primary keys identify the row and are absent from UpdateDTO.
acceptUpdate({ id: inc(1) });
acceptCreate({
  // @ts-expect-error create accepts values, not expressions.
  views: inc(1),
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
acceptUpdate({ views: proposed<number>() });
export type _accepted_set_value_admits_proposed = Expect<
  Equal<ColumnExpr<number> extends SetValue<number> ? true : false, true>
>;
