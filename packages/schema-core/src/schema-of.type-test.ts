// REQ-TF-10: a generated schema value derives the same types as the declaration it came from.
//
// `schemaOf<T>()` produces a `TaggedSchema<T>`, and the point of the phantom is that nothing
// downstream has to reconstruct `T` from the columns of a value. So the claim here is an
// equality, not an assignability: `Entity<ReturnType<typeof schemaOf<T>>>` *is* `Entity<T>`,
// the one in `./derive`, and every consumer of the schema-value derivations — the repository
// above all — gets the tagged answer without knowing the tagged types exist.
//
// The table is declared twice below, so the two spellings need two names: `TaggedUser` is the
// declaration and `ValueUserSchema` is a plain `CoreSchema` for the same `users` table.
//
// The other half of the claim is that an untagged schema value is untouched. A brand that leaked
// into the column-map branch would be the worst outcome available: every repository holding a
// `CoreSchema` would silently start deriving `unknown` rows.
//
// `ValueUserSchema` used to be `defineSchema('users', { id: serial().primaryKey(), … })`, and it
// is a `declare const` now — which says something about the branch it exercises. The only
// remaining producer of an untagged schema value is `schemaFromIR`, and its return type is
// `CoreSchema<string>` with `columns: Record<string, ColumnMeta>`: no literal column types, so
// the column-map derivation has nothing to read off it. The branch is reachable and correct, and
// nothing in the repository now reaches it with a literal. That is the evidence for collapsing
// the four derivations onto the declared type, which is its own commit.
//
// No runtime code: a compilation gate, run by `yarn typecheck` and therefore by CI.

import type {
  CreateDTO as TaggedCreateDTO,
  Entity as TaggedEntity,
  PrimaryKeyOf as TaggedPrimaryKeyOf,
  UpdateDTO as TaggedUpdateDTO,
} from './derive/index.ts';
import type { WhereDTO } from './dto/index.ts';
// `schemaOf` is imported for its *signature*: the assertions below are about what
// `ReturnType` makes of it, and it has no runtime behaviour worth calling.
import type {
  CoreSchema,
  CreateDTO,
  Entity,
  Equal,
  Expect,
  Extends,
  PrimaryKeyOf,
  schemaOf,
  TaggedSchema,
  UpdateDTO,
} from './index.ts';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from './tags/index.ts';

interface TaggedUser extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

type Generated = ReturnType<typeof schemaOf<TaggedUser>>;

// The generated value is a schema value. This is what `defineRepository` needs to be true.
type _IsSchema = Expect<Extends<Generated, CoreSchema<string>>>;

type _Ent = Expect<Equal<Entity<Generated>, TaggedEntity<TaggedUser>>>;
type _Create = Expect<Equal<CreateDTO<Generated>, TaggedCreateDTO<TaggedUser>>>;
type _Update = Expect<Equal<UpdateDTO<Generated>, TaggedUpdateDTO<TaggedUser>>>;
type _Key = Expect<Equal<PrimaryKeyOf<Generated>, TaggedPrimaryKeyOf<TaggedUser>>>;

// The read surface follows for free: `WhereDTO`, `OrderByDTO`, `PaginationDTO` and `ListDTO`
// are all built out of `Entity<S>`, so branding `Entity` brands them too. If that ever stops
// being true this is the assertion that says so.
type _Where = Expect<
  Equal<keyof WhereDTO<Generated>, keyof TaggedEntity<TaggedUser> | 'and' | 'or' | 'exists' | 'notExists'>
>;

// An untagged schema value is not a `TaggedSchema`, so it keeps the column-map derivation.
//
// The column map is spelled without `readonly`, which is not cosmetic: the column-map branch of
// `Entity` is a homomorphic mapped type and so copies the modifier through, while the tagged
// branch in `./derive` strips it with `-readonly`. `defineSchema` inferred `C` from an object
// literal and never produced a readonly map, so this is the shape that branch was written for.
declare const ValueUserSchema: {
  table: 'users';
  columns: {
    id: { type: 'serial'; flags: { nullable: false; primaryKey: true } };
    email: { type: 'text'; flags: { nullable: false } };
    createdAt: { type: 'timestamp'; flags: { nullable: false; hasDefault: true } };
  };
  primaryKey: readonly ['id'];
  references: readonly [];
};
type _NotTagged = Expect<Equal<Extends<typeof ValueUserSchema, TaggedSchema<unknown>>, false>>;
type _AuthoredEnt = Expect<Equal<Entity<typeof ValueUserSchema>, { id: number; email: string; createdAt: Date }>>;
