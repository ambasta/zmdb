// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { TaggedSchema } from '@zmdb/schema';
import type { CreateDTO, DeclaredTable, Entity, UpdateDTO } from '@zmdb/schema/derive';
import type { UnknownRow } from '@zmdb/schema/dto';
import type { Table } from '@zmdb/schema/tags';

import type { Predicate } from './clauses.js';
import type { CompiledQuery } from './compiled-query.js';
import type { DialectTarget } from './dialects/index.js';
import type { SetValue } from './expressions/index.js';
import type {
  AliasedDistanceExpression,
  DistanceExpression,
  GeometryColumnOf,
  SpatialPredicate,
  VectorColumnOf,
} from './extensions/index.js';
import type { Direction, Operator, TrustedTable, UnsafeOperator } from './index.js';

export type TableName<T extends DeclaredTable> = T extends Table<infer Name> ? Name : never;
type Key<Row> = Extract<keyof Row, string>;
type Simplify<Row> = { [K in keyof Row]: Row[K] };
type Nullable<Row> = { [K in keyof Row]: Row[K] | null };
type Qualified<Row, Alias extends string> = { [K in Key<Row> as `${Alias}.${K}`]: Row[K] };
type ScopeOf<T extends DeclaredTable, Alias extends string> = Entity<T> & Qualified<Entity<T>, Alias>;
type Merge<A, B> = Simplify<Omit<A, keyof B> & B>;
type SelectionOrEmpty<Selected> = Selected extends undefined ? {} : Selected;
type Wide<Row> = string extends keyof Row ? true : false;
type Value<Row, K extends Key<Row>> = Wide<Row> extends true ? unknown : Row[K];
type SelectedRow<Row, Selected, Computed> =
  Wide<Row> extends true
    ? UnknownRow
    : Simplify<(Selected extends undefined ? (keyof Computed extends never ? Row : {}) : Selected) & Computed>;

type ScalarSubquery<V> = { compile(): CompiledQuery; readonly _type?: Readonly<Record<string, Primitive<V>>> };
type Operand<V, Op> =
  Op extends UnsafeOperator
    ? unknown
    : Op extends string
      ? Lowercase<Op> extends 'in' | 'not in' | 'nin'
        ? readonly V[] | ScalarSubquery<V>
        : Lowercase<Op> extends 'is null' | 'is not null'
          ? null | undefined
          : Lowercase<Op> extends 'like' | 'ilike'
            ? NonNullable<V> extends string
              ? V | ScalarSubquery<V>
              : never
            : V | ScalarSubquery<V>
      : V | ScalarSubquery<V>;
type WhereOperand<Row, K extends Key<Row>, Op> = Wide<Row> extends true ? unknown : Operand<Row[K], Op>;

type Comparison<Row> = {
  [K in Key<Row>]: {
    readonly col: K;
    readonly op: Operator;
    readonly value: Wide<Row> extends true
      ? unknown
      : Row[K] | readonly Row[K][] | ScalarSubquery<Row[K]> | null | undefined;
    readonly kind?: 'comparison';
    readonly connector?: 'AND' | 'OR' | undefined;
  };
}[Key<Row>];

/** Predicates are keyed by the selected table scope, including inside groups. */
export type QueryPredicate<Row> =
  Wide<Row> extends true
    ? Predicate
    :
        | Comparison<Row>
        | {
            readonly kind: 'group';
            readonly predicates: readonly QueryPredicate<Row>[];
            readonly connector?: 'AND' | 'OR' | undefined;
          }
        | SpatialPredicate<Wide<Row> extends true ? string : GeometryColumnOf<Row>>;

type Selection<Row> =
  | Key<Row>
  | { readonly column: Key<Row>; readonly alias: string }
  | AliasedDistanceExpression<Wide<Row> extends true ? string : VectorColumnOf<Row>>;
type SelectionKey<Item> = Item extends string
  ? Item
  : Item extends { readonly alias: infer Alias extends string }
    ? Alias
    : never;
type SelectionValue<Row, Item> = Item extends keyof Row
  ? Row[Item]
  : Item extends { readonly column: infer K extends keyof Row }
    ? Row[K]
    : Item extends AliasedDistanceExpression
      ? number
      : never;
type Projection<Row, Items extends readonly unknown[]> = {
  [Item in Items[number] as SelectionKey<Item>]: SelectionValue<Row, Item>;
};
type Unique<Items extends readonly unknown[], Seen extends PropertyKey = never> = Items extends readonly [
  infer Head,
  ...infer Rest,
]
  ? SelectionKey<Head> extends Seen
    ? never
    : Unique<Rest, Seen | SelectionKey<Head>>
  : unknown;
type ValidSelection<Row, Items extends readonly unknown[], Computed> =
  Wide<Row> extends true ? unknown : Unique<Items, keyof Computed>;
type FreshAlias<Alias extends string, Selected, Computed> = Alias extends
  | keyof Computed
  | keyof SelectionOrEmpty<Selected>
  ? never
  : Alias;
type NumericKeys<Row> =
  Wide<Row> extends true
    ? string
    : { [K in Key<Row>]: NonNullable<Row[K]> extends number | bigint ? K : never }[Key<Row>];
type TextKeys<Row> =
  Wide<Row> extends true ? string : { [K in Key<Row>]: NonNullable<Row[K]> extends string ? K : never }[Key<Row>];

type Primitive<V> = V extends string
  ? string
  : V extends number
    ? number
    : V extends bigint
      ? bigint
      : V extends boolean
        ? boolean
        : V;
type JoinPairs<Left, Right> =
  Wide<Left> extends true
    ? { readonly leftCol: string; readonly rightCol: string }
    : {
        [L in Key<Left>]: {
          [R in Key<Right>]: Primitive<NonNullable<Left[L]>> extends Primitive<NonNullable<Right[R]>>
            ? { readonly leftCol: L; readonly rightCol: R }
            : never;
        }[Key<Right>];
      }[Key<Left>];

type JoinScope<Scope, Target, Kind extends 'inner' | 'left' | 'right'> = Simplify<
  (Kind extends 'right' ? Nullable<Scope> : Scope) & (Kind extends 'left' ? Nullable<Target> : Target)
>;
type JoinRoot<Root, Kind extends 'inner' | 'left' | 'right'> = Kind extends 'right' ? Nullable<Root> : Root;
type JoinSelection<Selected, Kind extends 'inner' | 'left' | 'right'> = Kind extends 'right'
  ? Selected extends undefined
    ? undefined
    : Nullable<Selected>
  : Selected;

interface JoinMethod<Root, Scope, Aliases extends string, Selected, Computed, Kind extends 'inner' | 'left' | 'right'> {
  <T extends DeclaredTable, const Alias extends string>(
    target: TaggedSchema<T>,
    alias: Wide<Scope> extends true ? Alias : Alias extends Aliases ? never : Alias,
    conditions: readonly JoinPairs<Scope, Qualified<Entity<T>, Alias>>[],
    on?: readonly QueryPredicate<Scope & Qualified<Entity<T>, Alias>>[],
  ): SelectBuilder<
    JoinRoot<Root, Kind>,
    JoinScope<Scope, Qualified<Entity<T>, Alias>, Kind>,
    Aliases | Alias,
    JoinSelection<Selected, Kind>,
    Computed
  >;
  (
    target: TrustedTable,
    alias: string,
    conditions: readonly { readonly leftCol: string; readonly rightCol: string }[],
    on?: readonly QueryPredicate<UnknownRow>[],
  ): SelectBuilder;
}

/** One schema-bound query surface for select, joins, aggregate/group and full-text operations. */
export interface SelectBuilder<
  Root = UnknownRow,
  Scope = Root,
  Aliases extends string = string,
  Selected = undefined,
  Computed = {},
> {
  readonly dialect: DialectTarget;
  readonly _type?: SelectedRow<Root, Selected, Computed>;
  select(): this;
  select<const Items extends readonly Selection<Scope>[]>(
    columns: Items & ValidSelection<Scope, Items, Computed>,
  ): SelectBuilder<Root, Scope, Aliases, Items extends readonly [] ? undefined : Projection<Scope, Items>, Computed>;
  where(predicate: SpatialPredicate<Wide<Scope> extends true ? string : GeometryColumnOf<Scope>>): this;
  where<K extends Key<Scope>, Op extends Operator | UnsafeOperator>(
    column: K,
    op: Op,
    value: WhereOperand<Scope, NoInfer<K>, Op>,
  ): this;
  andWhere(predicate: SpatialPredicate<Wide<Scope> extends true ? string : GeometryColumnOf<Scope>>): this;
  andWhere<K extends Key<Scope>, Op extends Operator | UnsafeOperator>(
    column: K,
    op: Op,
    value: WhereOperand<Scope, NoInfer<K>, Op>,
  ): this;
  orWhere(predicate: SpatialPredicate<Wide<Scope> extends true ? string : GeometryColumnOf<Scope>>): this;
  orWhere<K extends Key<Scope>, Op extends Operator | UnsafeOperator>(
    column: K,
    op: Op,
    value: WhereOperand<Scope, NoInfer<K>, Op>,
  ): this;
  whereGroup(predicates: readonly QueryPredicate<Scope>[]): this;
  orWhereGroup(predicates: readonly QueryPredicate<Scope>[]): this;
  whereIn<K extends Key<Scope>>(column: K, values: readonly Value<Scope, NoInfer<K>>[]): this;
  andWhereIn<K extends Key<Scope>>(column: K, values: readonly Value<Scope, NoInfer<K>>[]): this;
  orWhereIn<K extends Key<Scope>>(column: K, values: readonly Value<Scope, NoInfer<K>>[]): this;
  whereNotIn<K extends Key<Scope>>(column: K, values: readonly (Value<Scope, NoInfer<K>> | null | undefined)[]): this;
  andWhereNotIn<K extends Key<Scope>>(
    column: K,
    values: readonly (Value<Scope, NoInfer<K>> | null | undefined)[],
  ): this;
  orWhereNotIn<K extends Key<Scope>>(column: K, values: readonly (Value<Scope, NoInfer<K>> | null | undefined)[]): this;
  whereExists(subquery: { compile(): CompiledQuery }): this;
  andWhereExists(subquery: { compile(): CompiledQuery }): this;
  orWhereExists(subquery: { compile(): CompiledQuery }): this;
  whereNotExists(subquery: { compile(): CompiledQuery }): this;
  andWhereNotExists(subquery: { compile(): CompiledQuery }): this;
  orWhereNotExists(subquery: { compile(): CompiledQuery }): this;
  orderBy(
    column:
      | Key<Merge<Scope, Computed & SelectionOrEmpty<Selected>>>
      | DistanceExpression<Wide<Scope> extends true ? string : VectorColumnOf<Scope>>,
    dir: Direction,
  ): this;
  limit(n: number): this;
  offset(n: number): this;
  innerJoin: JoinMethod<Root, Scope, Aliases, Selected, Computed, 'inner'>;
  leftJoin: JoinMethod<Root, Scope, Aliases, Selected, Computed, 'left'>;
  rightJoin: JoinMethod<Root, Scope, Aliases, Selected, Computed, 'right'>;
  count<const Alias extends string>(
    column: Key<Scope> | '*',
    alias: Wide<Scope> extends true ? Alias : FreshAlias<Alias, Selected, Computed>,
  ): SelectBuilder<Root, Scope, Aliases, Selected, Merge<Computed, Record<Alias, number>>>;
  sum<const Alias extends string>(
    column: NumericKeys<Scope>,
    alias: Wide<Scope> extends true ? Alias : FreshAlias<Alias, Selected, Computed>,
  ): SelectBuilder<Root, Scope, Aliases, Selected, Merge<Computed, Record<Alias, number | null>>>;
  avg<const Alias extends string>(
    column: NumericKeys<Scope>,
    alias: Wide<Scope> extends true ? Alias : FreshAlias<Alias, Selected, Computed>,
  ): SelectBuilder<Root, Scope, Aliases, Selected, Merge<Computed, Record<Alias, number | null>>>;
  min<K extends Key<Scope>, const Alias extends string>(
    column: K,
    alias: Wide<Scope> extends true ? Alias : FreshAlias<Alias, Selected, Computed>,
  ): SelectBuilder<Root, Scope, Aliases, Selected, Merge<Computed, Record<Alias, Scope[K] | null>>>;
  max<K extends Key<Scope>, const Alias extends string>(
    column: K,
    alias: Wide<Scope> extends true ? Alias : FreshAlias<Alias, Selected, Computed>,
  ): SelectBuilder<Root, Scope, Aliases, Selected, Merge<Computed, Record<Alias, Scope[K] | null>>>;
  /** Explicit trusted SQL expression; its output remains unknown. */
  expr<const Alias extends string>(
    sql: string,
    alias: Wide<Scope> extends true ? Alias : FreshAlias<Alias, Selected, Computed>,
  ): SelectBuilder<Root, Scope, Aliases, Selected, Merge<Computed, Record<Alias, unknown>>>;
  groupBy(...columns: Key<Scope>[]): this;
  having<K extends Key<Merge<Scope, Computed & SelectionOrEmpty<Selected>>>, Op extends Operator | UnsafeOperator>(
    column: K,
    op: Op,
    value: WhereOperand<Merge<Scope, Computed & SelectionOrEmpty<Selected>>, NoInfer<K>, Op>,
  ): this;
  whereMatch(column: TextKeys<Scope>, term: string): this;
  compile(): CompiledQuery;
}

type Patch<T extends DeclaredTable> =
  Wide<Entity<T>> extends true
    ? Record<string, unknown>
    : {
        [K in keyof UpdateDTO<T>]: SetValue<UpdateDTO<T>[K]>;
      };
type InsertValues<T extends DeclaredTable> = Wide<Entity<T>> extends true ? Record<string, unknown> : CreateDTO<T>;
type Returning<T extends DeclaredTable> =
  | Key<Entity<T>>
  | '*'
  | { readonly column: Key<Entity<T>>; readonly alias: string };
type Returned<T extends DeclaredTable, Items extends readonly unknown[]> =
  Wide<Entity<T>> extends true ? UnknownRow : '*' extends Items[number] ? Entity<T> : Projection<Entity<T>, Items>;

export interface OnConflictBuilder<T extends DeclaredTable = UnknownRow, Result = UnknownRow> {
  doUpdate(
    updateFields?: readonly (Wide<Entity<T>> extends true ? string : Key<UpdateDTO<T>>)[] | Patch<T>,
  ): InsertBuilder<T, Result>;
  doNothing(): InsertBuilder<T, Result>;
}
export interface InsertBuilder<T extends DeclaredTable = UnknownRow, Result = UnknownRow> {
  readonly _type?: Result;
  values(row: InsertValues<T>): this;
  onConflict(target?: Key<Entity<T>> | readonly Key<Entity<T>>[]): OnConflictBuilder<T, Result>;
  returning(): InsertBuilder<T, Entity<T>>;
  returning<const Items extends readonly Returning<T>[]>(
    columns: Items & (Wide<Entity<T>> extends true ? unknown : Unique<Items>),
  ): InsertBuilder<T, Returned<T, Items>>;
  compile(): CompiledQuery;
}
interface WritePredicates<T extends DeclaredTable> {
  where<K extends Key<Entity<T>>, Op extends Operator>(
    column: K,
    op: Op,
    value: WhereOperand<Entity<T>, NoInfer<K>, Op>,
  ): this;
  orWhere<K extends Key<Entity<T>>, Op extends Operator>(
    column: K,
    op: Op,
    value: WhereOperand<Entity<T>, NoInfer<K>, Op>,
  ): this;
  whereGroup(predicates: readonly QueryPredicate<Entity<T>>[]): this;
  whereIn<K extends Key<Entity<T>>>(column: K, values: readonly Value<Entity<T>, NoInfer<K>>[]): this;
  whereNotIn<K extends Key<Entity<T>>>(
    column: K,
    values: readonly (Value<Entity<T>, NoInfer<K>> | null | undefined)[],
  ): this;
}
export interface UpdateBuilder<T extends DeclaredTable = UnknownRow, Result = UnknownRow> extends WritePredicates<T> {
  readonly _type?: Result;
  set(row: Patch<T>): this;
  returning(): UpdateBuilder<T, Entity<T>>;
  returning<const Items extends readonly Returning<T>[]>(
    columns: Items & (Wide<Entity<T>> extends true ? unknown : Unique<Items>),
  ): UpdateBuilder<T, Returned<T, Items>>;
  compile(): CompiledQuery;
}
export interface DeleteBuilder<T extends DeclaredTable = UnknownRow, Result = UnknownRow> extends WritePredicates<T> {
  readonly _type?: Result;
  returning(): DeleteBuilder<T, Entity<T>>;
  returning<const Items extends readonly Returning<T>[]>(
    columns: Items & (Wide<Entity<T>> extends true ? unknown : Unique<Items>),
  ): DeleteBuilder<T, Returned<T, Items>>;
  compile(): CompiledQuery;
}
export interface QueryCompiler {
  selectFrom<T extends DeclaredTable, const Alias extends string = TableName<T>>(
    schema: TaggedSchema<T>,
    alias?: Alias,
  ): SelectBuilder<Entity<T>, ScopeOf<T, Alias>, Alias>;
  selectFrom(target: TrustedTable, alias?: string): SelectBuilder;
  insertInto<T extends DeclaredTable>(schema: TaggedSchema<T>): InsertBuilder<T>;
  insertInto(target: TrustedTable): InsertBuilder;
  updateTable<T extends DeclaredTable>(schema: TaggedSchema<T>): UpdateBuilder<T>;
  updateTable(target: TrustedTable): UpdateBuilder;
  deleteFrom<T extends DeclaredTable>(schema: TaggedSchema<T>): DeleteBuilder<T>;
  deleteFrom(target: TrustedTable): DeleteBuilder;
  callFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callTableFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callProcedure(name: string, args: readonly unknown[]): CompiledQuery;
}
