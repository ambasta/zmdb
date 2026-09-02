// Schemas shared by the typed-populate files.
//
// Four files exercise the same shape: two `.spec.ts` over in-memory sqlite, and
// two `.type-test.ts` that are a compilation gate run by `yarn typecheck`. They
// only stay tests of the same claim if they agree about the shape, so the shape
// lives here once instead of four times.
//
// The relation maps that used to live here are gone. There were three —
// `userRelations`, `userJoinRelations` and `orderRelations` — and between them they held six
// facts that `User`, `Order` and `Profile` already stated: the target table, the foreign key
// and the cardinality of each relation, once as a tag and once as `childTable`/`childFk`/
// `parentKey`. Two of the three existed only to give one repository fewer populate keys than
// another over the same table, which is not something a table can be two ways about.
import { schemasFrom } from '@zmdb/aot-validator/testing';
import type {
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
} from '@zmdb/schema-core/tags';

import { OrderSchema, type Order } from '../orders-fixture.ts';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  orders?: Order[] & OneToMany<'orders', 'userId'>;
  /**
   * The inverse side of a one-to-one: `profiles.userId` is the key, so `users` joins from
   * its own primary key. `users` has no `userId`, which is how the repository knows.
   */
  profile?: Profile & OneToOne<'profiles', 'userId'>;
}

export interface Profile extends Table<'profiles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  bio: string & Sql<'text'>;
  user?: User & ManyToOne<'users', 'userId'>;
}

export const { User: UserSchema, Profile: ProfileSchema } = schemasFrom<{ User: User; Profile: Profile }>(
  import.meta.url,
  ['User', 'Profile'],
);

export { OrderSchema, type Order };
