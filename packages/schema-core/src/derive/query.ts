// @zmdb/schema-core/derive/query — the read/query surface, derived from a tagged type.
//
// The type-first counterpart of the schema-keyed shapes in `../dto/index.ts`, and per
// plan D2 single-input: every one of them takes the tagged type and nothing else.
// Phase 9 deletes the schema-keyed originals and re-points the package root here.
//
// Two things are deliberately *not* duplicated:
//
//   - **The operator vocabulary.** `FieldOps<V>` and `SubqueryTarget<V>` are keyed off
//     a column's value type and never mention a schema, so there is nothing in them to
//     re-point. Copying them here would be two operator sets to keep in step.
//   - **Every runtime helper.** `compileWhere`, `applyOrderBy`, `applyPagination`,
//     `project` and `buildListResult` already take schema-agnostic views —
//     `WhereTarget`, `OrderBySpec`, `PaginationSpec` — precisely so a caller's own typed
//     DTO is structurally assignable without a widening cast. A tagged type's DTO is
//     assignable to the same views, so the existing functions serve both. This file is
//     types only.
//
// The one shape that is genuinely better here than in `../dto/index.ts` is
// `GetOptions.populate`: schema-keyed it is `readonly string[]`, because a schema value
// carries no relations. A tagged type does, so it is `readonly RelationKeys<T>[]` and a
// misspelled relation name is a compile error.

import type { FieldOps, OffsetPage, OrderDir, SubqueryTarget } from '../dto/index.ts';
import type { Entity, RelationKeys } from './index.ts';

export type { ListResult } from '../dto/index.ts';

// ---------------------------------------------------------------------------
// Filtering.
// ---------------------------------------------------------------------------

/**
 * Filter shape: every column optional, either as a literal value or as an operator
 * bag, plus the boolean combinators.
 *
 * This replaced a `Partial<Entity<T>>` that carried no operators at all. The package
 * root publishes `WhereDTO` from `../dto/index.ts`, which has always had them, so the
 * weaker spelling would have quietly dropped `{ age: { gte: 18 } }` from every caller
 * the moment Phase 9 re-pointed the root here.
 */
export type WhereDTO<T> = {
  [K in keyof Entity<T>]?: Entity<T>[K] | FieldOps<Entity<T>[K]>;
} & {
  and?: readonly WhereDTO<T>[];
  or?: readonly WhereDTO<T>[];
  exists?: SubqueryTarget<unknown> | readonly SubqueryTarget<unknown>[];
  notExists?: SubqueryTarget<unknown> | readonly SubqueryTarget<unknown>[];
};

// ---------------------------------------------------------------------------
// Ordering and paging.
// ---------------------------------------------------------------------------

export type OrderByDTO<T> = ReadonlyArray<{
  column: keyof Entity<T>;
  dir?: OrderDir;
}>;

/** Offset paging, or keyset paging by a partial row / an opaque cursor. */
export type PaginationDTO<T> =
  | OffsetPage
  | {
      limit: number;
      after?: Partial<Entity<T>> | string | undefined;
      before?: Partial<Entity<T>> | string | undefined;
    };

// ---------------------------------------------------------------------------
// Projection and reads.
// ---------------------------------------------------------------------------

export type Projection<T, K extends keyof Entity<T>> = Pick<Entity<T>, K>;

export interface GetOptions<T> {
  select?: readonly (keyof Entity<T>)[];
  populate?: readonly RelationKeys<T>[];
}

/** The row a `get` returns: narrowed to `select` when one was given, else the whole row. */
export type GetDTO<T, O extends GetOptions<T> = {}> = O['select'] extends readonly (infer K extends keyof Entity<T>)[]
  ? Projection<T, K>
  : Entity<T>;

export interface ListDTO<T> {
  where?: WhereDTO<T>;
  orderBy?: OrderByDTO<T>;
  page?: PaginationDTO<T>;
  select?: readonly (keyof Entity<T>)[];
}

// ---------------------------------------------------------------------------
// Relations.
// ---------------------------------------------------------------------------
//
// `K & keyof T` throughout: `RelationKeys<T>` *is* a subset of `keyof T` by
// construction, but it is produced by a mapped-type projection and TypeScript does not
// carry that fact forward, so an unqualified `T[K]` does not compile.

/**
 * The row plus the relations named by `K`, typed as declared.
 *
 * Nothing here decides cardinality, and that is the point: `author?: User &
 * ManyToOne<…>` is one `User` and `comments?: Comment[] & OneToMany<…>` is an array
 * because that is what the declaration says. The schema-value version had to read the
 * cardinality out of a `RelationMeta` and rebuild the array, through six nested
 * conditional types (`relations/index.ts`'s `RelationEntityFromDef`), because a
 * relation *value* does not carry the target's type.
 *
 * The relation tag survives on the populated property. It is an optional unique-symbol
 * slot, so it costs nothing and erases; stripping it would take a conditional type per
 * cardinality to buy nothing.
 *
 * `Exclude<T[P], undefined>` because a relation is declared optional — `author?:` — and
 * that is what makes it possible to hold an unpopulated `Post`. Populating it is
 * precisely the claim that it is there, so the `undefined` comes off. (`-?` alone will
 * not do it: the key set is `K & keyof T`, not `keyof T`, so the mapped type is not
 * homomorphic and the modifier has nothing to strip.)
 */
export type PopulatedEntity<T, K extends RelationKeys<T> = RelationKeys<T>> = Entity<T> & {
  -readonly [P in K & keyof T]: Exclude<T[P], undefined>;
};

/** Alias kept because both names are in use across the repository and the docs. */
export type Populated<T, K extends RelationKeys<T> = RelationKeys<T>> = PopulatedEntity<T, K>;

/** The target of a relation: the element type for a to-many, the type itself for a to-one. */
type RelationTargetOf<V> = NonNullable<V> extends readonly (infer E)[] ? E : NonNullable<V>;

/**
 * One row of a join: the base row's columns and the target's, flat.
 *
 * A `LEFT JOIN` can produce a row with no match, so the joined half is `Partial`. An
 * `INNER JOIN` cannot, so it is not — and that asymmetry is the whole reason `Kind` is
 * a parameter rather than always-partial.
 */
export type JoinRow<T, K extends RelationKeys<T>, Kind extends 'inner' | 'left' = 'left'> = Kind extends 'inner'
  ? Entity<T> & Entity<RelationTargetOf<T[K & keyof T]>>
  : Entity<T> & Partial<Entity<RelationTargetOf<T[K & keyof T]>>>;
