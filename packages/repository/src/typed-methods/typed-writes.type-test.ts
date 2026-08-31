import { defineSchema, serial, text, integer, jsonEnum } from '@zmdb/schema-core';
import type { Entity, CreateDTO } from '@zmdb/schema-core';

import type { BaseRepository } from '../index.ts';

type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});
type S = typeof UserSchema;

declare class Users extends BaseRepository<S> {
  static readonly schema: typeof UserSchema;
}

declare const repo: Users;

// Verify repo.upsert parameter type equals CreateDTO<S>
type _TestUpsertParam = Expect<Equal<Parameters<typeof repo.upsert>[0], CreateDTO<S>>>;

// Verify repo.upsert return type resolves to Entity<S> | undefined
type _TestUpsertReturn = Expect<Equal<Awaited<ReturnType<typeof repo.upsert>>, Entity<S> | undefined>>;
