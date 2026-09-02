// The two schemas the relation tests point at.
//
// `User` is the target every foreign key in these tests references, and `Profile` is
// the to-one side. Both the runtime spec and the `.type-test.ts` compilation gate need
// them, and they only test the same claim while they agree about the shape.
//
// The declaration is the interface; the schema values below are read off it the way a
// build would. See `@zmdb/aot-validator/testing`.
import { schemasFrom } from '@zmdb/aot-validator/testing';

import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.ts';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

export interface Profile extends Table<'profiles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'>;
  bio: string & Sql<'text'>;
}

export const { User: UserSchema, Profile: ProfileSchema } = schemasFrom<{ User: User; Profile: Profile }>(
  import.meta.url,
  ['User', 'Profile'],
);
