// Type-level tests for the read/query DTO family. No runtime code: this file is
// a *compilation* gate, run by `yarn typecheck` (and therefore by CI).
//
// These assertions used to live in `it('type-level: …')` blocks inside the
// sibling `.spec.ts` files, where `expectTypeOf` is a runtime no-op and the
// package tsconfig excludes `**/*.spec.ts` — so nothing checked them. Here a
// wrong derived type is a build error.
import type { Entity, Equal, Expect, Extends } from '../index.ts';
import { defineSchema, serial, text, integer, jsonEnum, numeric } from '../index.ts';
import type {
  AggregateResult,
  FieldOps,
  GetDTO,
  ListResult,
  OrderByDTO,
  PaginationSpec,
  Projection,
  SearchDTO,
  SearchHit,
  SubqueryTarget,
  WhereDTO,
} from './index.ts';
import { applyOrderBy, applyPagination, buildListResult, compileWhere, project } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
});
type S = typeof UserSchema;

// --- WhereDTO (#179) -------------------------------------------------------
// Fields are value-typed, and `like`/`ilike` exist only on string fields.
export type _Where1 = Expect<Equal<WhereDTO<S>['age'], number | FieldOps<number> | undefined>>;
export type _Where2 = Expect<Equal<FieldOps<string>['like'], string | SubqueryTarget<string> | undefined>>;
export type _Where3 = Expect<Equal<FieldOps<number>['like'], undefined>>;
export type _Where4 = Expect<
  Equal<FieldOps<Entity<S>['role']>['eq'], 'admin' | 'user' | SubqueryTarget<'admin' | 'user'> | undefined>
>;
export type _Where5 = Expect<
  Equal<WhereDTO<S>['exists'], SubqueryTarget<unknown> | readonly SubqueryTarget<unknown>[] | undefined>
>;
export type _Where6 = Expect<
  Equal<WhereDTO<S>['notExists'], SubqueryTarget<unknown> | readonly SubqueryTarget<unknown>[] | undefined>
>;

// --- OrderByDTO (#182) -----------------------------------------------------
export type _Order1 = Expect<Equal<OrderByDTO<S>[number]['column'], 'id' | 'email' | 'age' | 'role'>>;

// --- Projection (#185) -----------------------------------------------------
export type _Proj1 = Expect<Equal<Projection<S, 'id' | 'email'>, { id: number; email: string }>>;
export type _Proj2 = Expect<Equal<keyof Entity<S>, 'id' | 'email' | 'age' | 'role'>>;

// --- GetDTO (#165) ---------------------------------------------------------
export type _Get1 = Expect<Equal<GetDTO<S>, Entity<S>>>;
export type _Get2 = Expect<Equal<GetDTO<S, { select: readonly ['id', 'age'] }>, { id: number; age: number }>>;

// --- ListResult (#168) -----------------------------------------------------
export type _List1 = Expect<
  Extends<ListResult<{ id: number }>, { items: readonly { id: number }[]; hasMore: boolean }>
>;

// --- SearchDTO (#171) ------------------------------------------------------
export type _Search1 = Expect<Equal<SearchDTO<S>['query'], string>>;
export type _Search2 = Expect<Equal<SearchHit<{ id: number }>['_score'], number | undefined>>;

// --- AggregateResult (#198) ------------------------------------------------
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  customerId: integer().notNull(),
  total: numeric().notNull(),
  status: text().notNull(),
});
type AggSpec = {
  groupBy: readonly ['customerId'];
  computed: {
    orderCount: { fn: 'count' };
    revenue: { fn: 'sum'; column: 'total' };
    firstStatus: { fn: 'min'; column: 'status' };
  };
};
type R = AggregateResult<typeof OrderSchema, AggSpec>;
export type _Agg1 = Expect<Equal<R['customerId'], number>>;
export type _Agg2 = Expect<Equal<R['orderCount'], number>>;
export type _Agg3 = Expect<Equal<R['revenue'], number | null>>;
export type _Agg4 = Expect<Equal<R['firstStatus'], string | null>>;

// --- Builder folding preserves the concrete builder type -------------------
// The reason `WhereTarget`/`OrderTarget` return `this`: folding a DTO into a
// builder must not widen it to the structural view, or every caller needs
// `as typeof b` to get its own builder back.
interface FakeBuilder {
  where(col: string, op: string, value: unknown): this;
  orWhere(col: string, op: string, value: unknown): this;
  orderBy(col: string, dir: 'asc' | 'desc'): this;
  limit(n: number): this;
  offset(n: number): this;
  marker: 'concrete';
}
declare const fake: FakeBuilder;
declare const where: WhereDTO<S>;
declare const orderBy: OrderByDTO<S>;
declare const page: PaginationSpec;
export type _Fold1 = Expect<Equal<ReturnType<typeof compileWhere<S, FakeBuilder>>, FakeBuilder>>;
export type _Fold2 = Expect<Equal<ReturnType<typeof applyOrderBy<FakeBuilder>>, FakeBuilder>>;
export type _Fold3 = Expect<Equal<ReturnType<typeof applyPagination<FakeBuilder>>, FakeBuilder>>;
// A schema-typed DTO is accepted by the schema-agnostic folders with no cast —
// this is what removed the `as OrderByDTO<CoreSchema<string>>` from callers.
export const _foldChain: FakeBuilder = applyPagination(applyOrderBy(compileWhere(fake, where), orderBy), page);

// --- project()/buildListResult() overloads --------------------------------
// No `select` ⇒ the row type survives (this is what let `list()` drop its
// `as ListResult<Entity<S>>`); with `select` ⇒ narrowed to the picked keys.
// (Asserted at the value level: an overloaded signature cannot be probed with
// `ReturnType`, which resolves to the last overload regardless of the arguments.)
declare const rows: readonly { id: number; email: string }[];
export const _picked: { id: number } = project({ id: 1, email: 'a' }, ['id']);
export const _listAll: ListResult<{ id: number; email: string }> = buildListResult(rows, { limit: 10 });
export const _listPicked: ListResult<{ id: number }> = buildListResult(rows, { limit: 10, select: ['id'] });
