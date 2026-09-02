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
export type PopulatedEntity<T extends DeclaredTable, K extends RelationKeys<T> = RelationKeys<T>> = Entity<T> & {
  -readonly [P in K & keyof T]: Exclude<T[P], undefined>;
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
 * the join that names its target directly instead of by a relation. This one restates the
 * two lines rather than importing them, because `relations` reads the package root and the
 * root re-exports this file — one type-only import cycle to save one conditional is a bad
 * trade. If a third spelling ever wants them, that is the point to extract.
 */
export type JoinRow<
  T extends DeclaredTable,
  K extends RelationKeys<T>,
  Kind extends 'inner' | 'left' = 'left',
> = Kind extends 'inner'
  ? Entity<T> & Entity<RelationTargetOf<T[K & keyof T]>>
  : Entity<T> & Partial<Entity<RelationTargetOf<T[K & keyof T]>>>;
