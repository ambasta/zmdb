// @zmdb/schema-core/derive/query — the relation-aware half of the read surface.
//
// This file used to restate the whole query DTO family, because there were two of them:
// `../dto/index.ts` was keyed by the schema value and these were keyed by the declared
// type. There is one family now — `WhereDTO`, `OrderByDTO`, `PaginationDTO`, `Projection`,
// `GetOptions`, `GetDTO` and `ListDTO` all take the declared type, and they live in
// `../dto/index.ts` alongside the operator vocabulary and the runtime folders that read
// them. Two copies of `WhereDTO` were two operator sets to keep in step; the copy is gone
// and the names below are re-exports, so importing from either path is the same type.
//
// What is genuinely *here* is the three shapes that need a relation: a populated row and
// the two spellings of a join row. Those read `RelationKeys<T>` and the relation tags off
// the declaration, which is something only a declared type can answer — a schema value
// carries no relations at all, which is why the version of `Populated` this replaced had
// to rebuild the cardinality out of a `RelationMeta` through six nested conditionals.

import type { DeclaredTable, Entity, RelationKeys } from './index.ts';

export type {
  GetDTO,
  GetOptions,
  ListDTO,
  ListResult,
  OrderByDTO,
  PaginationDTO,
  Projection,
  WhereDTO,
} from '../dto/index.ts';

// ---------------------------------------------------------------------------
// Relations.
// ---------------------------------------------------------------------------
//
// `K & keyof T` throughout: `RelationKeys<T>` *is* a subset of `keyof T` by
// construction, but it is produced by a mapped-type projection and TypeScript does not
// carry that fact forward, so an unqualified `T[K]` does not compile.

/**
 * What a populated relation holds: fetched rows, and what happens when nothing matched.
 *
 * Cardinality comes from the declaration and nothing else, which is the point: `comments?:
 * Comment[] & OneToMany<…>` is an array because it was written as one, and `author?: User &
 * ManyToOne<…>` is not. The schema-value version had to read the cardinality out of a
 * `RelationMeta` and rebuild the array, through six nested conditional types named
 * `RelationEntityFromDef` and `RelationCardinalityFromDef`, because a relation *value* does
 * not carry the target's type. Both are deleted.
 *
 * Two things do change on the way through. The target becomes `Entity<>`: a populated child
 * is a fetched row, so its own relations are not there to read, exactly as for the parent.
 * And a to-one gains `| null`, because a foreign key that matches nothing is a row the
 * database can hold — `null` is what the repository attaches for it, and a type that said
 * `User` there would be wrong for the case the query cannot rule out. A to-many needs no
 * such arm: no match is the empty array.
 */
type PopulatedValue<V> =
  NonNullable<V> extends readonly (infer E)[]
    ? readonly Entity<E & DeclaredTable>[]
    : Entity<NonNullable<V> & DeclaredTable> | null;

/**
 * The row plus the relations named by `K`, populated.
 *
 * The key set is `K & keyof T` rather than `K`: `RelationKeys<T>` *is* a subset of `keyof T`
 * by construction, but it is a mapped-type projection and TypeScript will not carry that
 * forward for an unresolved `T`.
 */
export type PopulatedEntity<T extends DeclaredTable, K extends RelationKeys<T> = RelationKeys<T>> = Entity<T> & {
  -readonly [P in K & keyof T]: PopulatedValue<T[P]>;
};

/** Alias kept because both names are in use across the repository and the docs. */
export type Populated<T extends DeclaredTable, K extends RelationKeys<T> = RelationKeys<T>> = PopulatedEntity<T, K>;

/**
 * The target of a relation: the element type for a to-many, the type itself for a to-one.
 *
 * `& DeclaredTable` on the way out rather than a constraint on the way in. A relation is
 * declared as `Comment[] & OneToMany<…>`, so the element type is whatever the author wrote
 * there and TypeScript cannot be told in advance that it is a table — but `Entity<>` wants
 * to know, and intersecting is assignable by definition where proving is not.
 */
type RelationTargetOf<V> = (NonNullable<V> extends readonly (infer E)[] ? E : NonNullable<V>) & DeclaredTable;

/**
 * One row of a join: the base row's columns and the target's, flat.
 *
 * A `LEFT JOIN` can produce a row with no match, so the joined half is `Partial`. An
 * `INNER JOIN` cannot, so it is not — and that asymmetry is the whole reason `Kind` is
 * a parameter rather than always-partial.
 *
 * `../relations/index.ts` exports the same asymmetry as `JoinRow<Base, Joined, Kind>`, for
 * the join that names its target directly instead of by a relation. Two shapes, because they
 * take different arguments: that one is given both tables, this one is given a base table and
 * the name of one of its relations. The conditional itself is two lines and duplicating it is
 * cheaper than a shared helper neither would read more clearly.
 */
export type JoinRow<
  T extends DeclaredTable,
  K extends RelationKeys<T>,
  Kind extends 'inner' | 'left' = 'left',
> = Kind extends 'inner'
  ? Entity<T> & Entity<RelationTargetOf<T[K & keyof T]>>
  : Entity<T> & Partial<Entity<RelationTargetOf<T[K & keyof T]>>>;
