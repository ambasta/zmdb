import type { CreateDTO, Entity, Equal, Expect, UpdateDTO } from '@zmdb/schema-core';

import type { TenantUser, User, Users } from './typed-methods.fixture.js';

declare const repo: Users;

// Verify repo.upsert parameter type equals CreateDTO<User>
type _TestUpsertParam = Expect<Equal<Parameters<typeof repo.upsert>[0], CreateDTO<User>>>;

// Verify repo.upsert return type resolves to Entity<User> | undefined
type _TestUpsertReturn = Expect<Equal<Awaited<ReturnType<typeof repo.upsert>>, Entity<User> | undefined>>;

// Every primary-key column is identity, so none of a composite key is patchable.
type _TestCompositeUpdateKeys = Expect<Equal<keyof UpdateDTO<TenantUser>, 'role'>>;
