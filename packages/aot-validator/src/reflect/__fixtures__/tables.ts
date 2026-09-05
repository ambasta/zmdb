// The tables every back-end is checked against, declared once.
//
// Four specs read this file, and between them they cover the four things the IR feeds:
// `reflect.spec.ts` pins the `SchemaIR` itself, `documents.spec.ts` the JSON Schema,
// `payload-types.spec.ts` the validator's `TypeIR`, and `schema-values.spec.ts` the emitted
// schema value. So a column added here is a column all four look at, which is the point of
// there being one corpus rather than a fixture per spec.
//
// Nothing imports this at runtime: `pair` and `taggedOnly` are declarations, not functions,
// and exist only to hand a type to the checker at a findable call site. The specs that want
// a schema *value* out of these interfaces get one from `@zmdb/aot-validator/testing`, which
// reflects the file the same way the transform would.
//
// The split between the two declarations is what the golden covers versus what it does not.
// `pair<T>` tables are written out in full in `reflect.spec.ts` and reused by the three
// back-end specs; `taggedOnly<T>` tables carry the constructs that are asserted one at a
// time — `Numeric<P, S>` precision, `Codec<Name>`, `WireAs<W>`, a `json` payload shape and
// relations — because each is a single fact and a whole second golden to state it would bury
// the fact rather than pin it. And one thing no declaration can say at all: the default
// *value*. `HasDefault` means "has one", not "has this one".
//
// Nullability is written `(T & Tags) | null`, tags inside, `| null` outside. The other
// order is a trap rather than a style choice: TypeScript normalises an intersection
// containing a union into a union of intersections, so `(T | null) & Unique` becomes
// `(T & Unique) | (null & Unique)` — and `null & Unique` reduces to `never`, silently
// dropping the nullability.

import type {
  Codec,
  Ext,
  ForeignKey,
  Fts,
  HasDefault,
  Length,
  ManyToMany,
  ManyToOne,
  Max,
  MaxLength,
  Min,
  MinLength,
  Numeric,
  OnDelete,
  OneToOne,
  OnUpdate,
  Pattern,
  PrimaryKey,
  References,
  Rowstore,
  Sensitive,
  Serial,
  ShardKey,
  Sql,
  SortKey,
  Table,
  Unique,
  WireAs,
} from '@zmdb/schema-core/tags';

// Declarations, not functions: nothing calls them, and the second parameter is only
// there to give `T` a position the lint rule accepts. See `constructs.ts`.
declare function pair<T>(table: string, of?: T): void;
declare function taggedOnly<T>(label: string, of?: T): void;

/**
 * Every column kind, in one table.
 *
 * `Fts<'users_fts'>` is here rather than in the tagged-only section below because the golden
 * is the right place for the named spelling: it is a whole-`SchemaIR` comparison, so a
 * `ftsTable` that stopped arriving fails here rather than in a test written to look for it.
 */
export interface User extends Table<'users'>, Fts<'users_fts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\S+@\\S+$'>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  score: number & Sql<'numeric'>;
  visits: bigint & Sql<'bigint'>;
  bio: (string & Sql<'text'> & MinLength<3> & MaxLength<2000>) | null;
  active: boolean & Sql<'boolean'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  // No `Sql<'jsonEnum'>`: a literal union already says it, and asking for the tag as
  // well would be asking for the same fact twice (REQ-TF-2).
  //
  // Deliberately not written in alphabetical order: the checker does not preserve the order
  // a union was declared in, so `ColumnIR.enum` sorts, and the golden in `reflect.spec.ts`
  // states the sorted answer. While both orders were alphabetical this passed by luck.
  role: 'editor' | 'admin' | 'viewer';
  passwordHash: string & Sql<'text'> & Sensitive;
}
pair<User>('users');

/** A composite primary key, and a foreign key spelled `table.column`. */
export interface Membership extends Table<'memberships'> {
  userId: number & Sql<'integer'> & PrimaryKey & References<'users.id'>;
  groupId: number & Sql<'integer'> & PrimaryKey & References<'groups.id'>;
  invitedBy: (number & Sql<'integer'> & References<'users.id'>) | null;
}
pair<Membership>('memberships');

// ---------------------------------------------------------------------------
// The constructs asserted one at a time. Kept out of the golden above so it stays
// a table anyone can read, and asserted individually instead: a capability that is
// only mentioned in a comment is a capability nobody measures.
// ---------------------------------------------------------------------------

export interface Line {
  sku: string;
  qty: number & Sql<'integer'> & Min<1>;
}

/** A column type the library does not know: the app side of the `Money` codec. */
export interface Money {
  readonly cents: number;
}

export interface Author extends Table<'authors'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
}

export interface Invoice extends Table<'invoices'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  /** `numeric(12, 2)`. `ColumnMeta` has no precision field to hold this. */
  amount: number & Sql<'numeric'> & Numeric<12, 2>;
  /** A json column whose payload shape is known, which `sql: 'json'` alone cannot say. */
  lines: Line[] & Sql<'json'>;
  currency: string & Sql<'text'> & Codec<'currency'>;
  /**
   * A codec whose three types differ: cents in the database, a `Money` in the app, a
   * decimal string on the wire. Only this declaration knows the last one, which is why
   * `WireAs<W>` exists and why a codec column without it is refused.
   */
  total: Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>;
  /** Has a default. The *value* is not expressible in a type — see `HasDefault`. */
  issuedAt: Date & Sql<'timestamp'> & HasDefault;
  authorId: number & Sql<'integer'> & References<'authors.id'>;
  author: Author & ManyToOne<'authors', 'authorId'>;
}
taggedOnly<Invoice>('invoices');

export interface ReferentialFixture
  extends Table<'referential_fixtures'>, ForeignKey<'tenantId,userId', 'users', 'tenantId,id'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  tenantId: number & Sql<'integer'>;
  userId: (number & Sql<'integer'> & References<'users.id'> & OnDelete<'set null'> & OnUpdate<'cascade'>) | null;
}
taggedOnly<ReferentialFixture>('referential-actions');

export interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

export interface ExtensionItem extends Table<'extension_items'> {
  id: number & Sql<'integer'> & PrimaryKey;
  __zmdbExt: string & Sql<'text'>;
  embedding: readonly number[] & Ext<'vector', 'vector', [1536]>;
  location: GeoJsonPoint & Ext<'postgis', 'geometry', ['Point', 4326]>;
  handle: string & Ext<'citext', 'citext'>;
}
taggedOnly<ExtensionItem>('extension-items');

export interface Listing extends Table<'listings'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  productId: number & Sql<'integer'> & References<'products.id'>;
}

export interface Label extends Table<'labels'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'varchar'> & Length<64> & Unique;
}

/**
 * The other two cardinalities, and full-text search asked for by default.
 *
 * `manyToMany` names a *join table* where the other three name a foreign key, and the IR
 * carries one field (`via`) for both — so this is the fixture that says which one the
 * reflection read. `oneToOne` puts the join column on the far table, which changes nothing
 * about the IR and everything about the SQL, so it is here to prove the cardinality survives
 * the trip rather than being inferred back from the declared type.
 *
 * `Fts<true>` is the boolean spelling: "give this table an FTS index and name it yourself".
 * `Fts<'users_fts'>` above is the other, and both have to reach `SchemaIR.ftsTable` — a
 * `true` silently dropped would be an index nobody notices is missing until a search
 * returns nothing.
 */
export interface Product extends Table<'products'>, Fts<true> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'varchar'> & Length<200>;
  labels?: Label[] & ManyToMany<'labels', 'product_labels'>;
  listing?: Listing & OneToOne<'listings', 'productId'>;
}
taggedOnly<Product>('products');

export interface DistributedOrder
  extends Table<'distributed_orders'>, ShardKey<['customerId']>, SortKey<['createdAt', 'id']> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
  customerId: bigint & Sql<'bigint'>;
  createdAt: Date & Sql<'timestamp'>;
}
taggedOnly<DistributedOrder>('distributed-orders');

export interface Session extends Table<'sessions'>, Rowstore {
  id: string & Sql<'text'> & PrimaryKey;
  value: string & Sql<'text'>;
}
taggedOnly<Session>('rowstore-sessions');
