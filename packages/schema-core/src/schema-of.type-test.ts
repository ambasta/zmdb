// REQ-TF-10: a generated schema value derives the same types as the declaration it came from.
//
// `schemaOf<User>()` produces a `TaggedSchema<User>`, and the point of the phantom is that
// nothing downstream has to reconstruct `User` from the columns of a value. So the claim here
// is an equality, not an assignability: `Entity<schemaOf<User>>` *is* `Entity<User>`, the one
// in `./derive`, and every consumer of the schema-value derivations — the repository above
// all — gets the tagged answer without knowing the tagged types exist.
//
// The other half of the claim is that an authored schema is untouched. A brand that leaked
// into the `defineSchema` branch would be the worst outcome available: every existing
// repository would silently start deriving `unknown` rows.
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
import {
  defineSchema,
  serial,
  text,
  timestamp,
  type CoreSchema,
  type CreateDTO,
  type Entity,
  type Equal,
  type Expect,
  type Extends,
  type PrimaryKeyOf,
  type schemaOf,
  type TaggedSchema,
  type UpdateDTO,
} from './index.ts';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from './tags/index.ts';

interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

type Generated = ReturnType<typeof schemaOf<User>>;

// The generated value is a schema value. This is what `defineRepository` needs to be true.
type _IsSchema = Expect<Extends<Generated, CoreSchema<string>>>;

type _Ent = Expect<Equal<Entity<Generated>, TaggedEntity<User>>>;
type _Create = Expect<Equal<CreateDTO<Generated>, TaggedCreateDTO<User>>>;
type _Update = Expect<Equal<UpdateDTO<Generated>, TaggedUpdateDTO<User>>>;
type _Key = Expect<Equal<PrimaryKeyOf<Generated>, TaggedPrimaryKeyOf<User>>>;

// The read surface follows for free: `WhereDTO`, `OrderByDTO`, `PaginationDTO` and `ListDTO`
// are all built out of `Entity<S>`, so branding `Entity` brands them too. If that ever stops
// being true this is the assertion that says so.
type _Where = Expect<
  Equal<keyof WhereDTO<Generated>, keyof TaggedEntity<User> | 'and' | 'or' | 'exists' | 'notExists'>
>;

// A `defineSchema` value is not a `TaggedSchema`, so it keeps the value derivation.
const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text(),
  createdAt: timestamp().defaultTo('now()'),
});
type _NotTagged = Expect<Equal<Extends<typeof UserSchema, TaggedSchema<unknown>>, false>>;
type _AuthoredEnt = Expect<Equal<Entity<typeof UserSchema>, { id: number; email: string; createdAt: Date }>>;
