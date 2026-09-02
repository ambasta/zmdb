// The tagged half of the equivalence corpus. `equivalence-schemas.ts` is the other.
//
// One claim carries most of REQ-TF-7 and REQ-TF-12: for a table described BOTH ways,
// the two `SchemaIR`s are deep-equal. If that holds, every SQL snapshot, every JSON
// Schema golden and every DDL test the repo already has covers the tagged front-end
// too, because the back-ends are pure functions of the IR and cannot tell the two
// apart. Nothing else in Phase 4 buys as much.
//
// The two halves are separate files because this one is never imported at runtime:
// `pair` is a declaration, not a function, and exists only to hand a type to the
// checker. `reflect.spec.ts` asserts the two label sets are identical, so a table
// added on one side and forgotten on the other fails rather than goes unchecked.
//
// Four things a tagged declaration can say that `defineSchema` cannot, so no column
// here uses them: `Numeric<P, S>` precision, `Codec<Name>`, a `json` payload shape,
// and relations — `irFromSchema` returns `relations: []` unconditionally. And one
// thing `defineSchema` can say that a type cannot: the default *value*. `HasDefault`
// means "has one", not "has this one". `reflect.spec.ts` covers each separately.
//
// Nullability is written `(T & Tags) | null`, tags inside, `| null` outside. The other
// order is a trap rather than a style choice: TypeScript normalises an intersection
// containing a union into a union of intersections, so `(T | null) & Unique` becomes
// `(T & Unique) | (null & Unique)` — and `null & Unique` reduces to `never`, silently
// dropping the nullability.

import type {
  Codec,
  HasDefault,
  Length,
  ManyToOne,
  Max,
  MaxLength,
  Min,
  MinLength,
  Numeric,
  Pattern,
  PrimaryKey,
  References,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
} from '@zmdb/schema-core/tags';

// Declarations, not functions: nothing calls them, and the second parameter is only
// there to give `T` a position the lint rule accepts. See `constructs.ts`.
declare function pair<T>(table: string, of?: T): void;
declare function taggedOnly<T>(label: string, of?: T): void;

/** Every column kind that both front-ends can express, in one table. */
export interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
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
  // Written in a third order — the twin declares `viewer, admin, editor` and the IR reports
  // `admin, editor, viewer` — because the checker does not preserve the order either side
  // wrote, so `ColumnIR.enum` is sorted and the equivalence below is what proves it. While
  // all three orders were alphabetical this passed by luck.
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
// The four things only a tagged declaration can say. Kept out of the corpus above
// so the deep-equality assertion stays total, and asserted separately instead: an
// asymmetry that is only mentioned in a comment is an asymmetry nobody measures.
// ---------------------------------------------------------------------------

export interface Line {
  sku: string;
  qty: number & Sql<'integer'> & Min<1>;
}

export interface Author extends Table<'authors'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
}

export interface Invoice extends Table<'invoices'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  /** `numeric(12, 2)`. `ColumnFlags` has no precision field to hold this. */
  amount: number & Sql<'numeric'> & Numeric<12, 2>;
  /** `json<Line[]>()` carries the payload in a phantom parameter that is erased. */
  lines: Line[] & Sql<'json'>;
  currency: string & Sql<'text'> & Codec<'currency'>;
  /** Has a default. The *value* is not expressible in a type — see `HasDefault`. */
  issuedAt: Date & Sql<'timestamp'> & HasDefault;
  authorId: number & Sql<'integer'> & References<'authors.id'>;
  author: Author & ManyToOne<'authors', 'authorId'>;
}
taggedOnly<Invoice>('invoices');
