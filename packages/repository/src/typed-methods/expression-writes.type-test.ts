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
import type { CreateDTO, Entity, Equal, Expect, PrimaryKeyOf, UpdateDTO } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

import type {
  BaseRepository,
  CacheInvalidationOptions,
  NumericColumnOf,
  UpdatePatch,
  UpsertOptions,
} from '../index.js';

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

function acceptUpdate(_patch: UpdatePatch<Post>): void {}
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

export type _numeric_columns_come_from_numeric_sql_tags = Expect<
  Equal<NumericColumnOf<Post>, 'views' | 'total' | 'ratio'>
>;
export type _update_parameter_is_the_public_patch = Expect<
  Equal<Parameters<BaseRepository<Post>['update']>[1], UpdatePatch<Post>>
>;
export type _update_many_parameter_is_the_public_patch = Expect<
  Equal<Parameters<BaseRepository<Post>['updateMany']>[1], UpdatePatch<Post>>
>;
export type _unbound_upsert_options_keep_the_existing_broad_surface = Expect<
  Equal<NonNullable<UpsertOptions['updateFields']>, readonly string[] | Record<string, unknown>>
>;
export type _bound_upsert_options_use_the_table_patch = Expect<
  Equal<
    NonNullable<UpsertOptions<Post>['updateFields']>,
    readonly (keyof UpdateDTO<Post> & string)[] | UpdatePatch<Post>
  >
>;
type FrozenIncrement = <K extends NumericColumnOf<Post>>(
  id: PrimaryKeyOf<Post>,
  column: K,
  by?: Exclude<UpdateDTO<Post>[K], null | undefined>,
  options?: CacheInvalidationOptions,
) => Promise<Entity<Post> | undefined>;
export type _increment_signature_is_column_and_operand_specific = Expect<
  Equal<BaseRepository<Post>['increment'], FrozenIncrement>
>;

function exerciseRepositorySurface(repo: BaseRepository<Post>): void {
  repo.update(1, { views: inc(1), published: not() });
  repo.updateMany({ published: false }, { title: concat('!') });
  repo.upsert(
    { views: 1, total: 1n, ratio: 1, published: false, title: 'draft', nickname: null },
    { target: 'id', updateFields: { views: inc(1), title: proposed<string>() } },
  );
  repo.increment(1, 'views');
  repo.increment(1, 'views', 2);
  repo.increment(1, 'total', 2n);
  repo.increment(1, 'views', 2, { invalidateTags: ['post:1'] });
}

void exerciseRepositorySurface;
