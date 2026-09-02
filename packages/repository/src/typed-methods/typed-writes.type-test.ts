import type { CreateDTO, Entity, Equal, Expect } from '@zmdb/schema-core';

import type { User, Users } from './fixtures.ts';

declare const repo: Users;

// Verify repo.upsert parameter type equals CreateDTO<User>
type _TestUpsertParam = Expect<Equal<Parameters<typeof repo.upsert>[0], CreateDTO<User>>>;

// Verify repo.upsert return type resolves to Entity<User> | undefined
type _TestUpsertReturn = Expect<Equal<Awaited<ReturnType<typeof repo.upsert>>, Entity<User> | undefined>>;
