import type { CreateDTO, Entity, Equal, Expect } from '@zmdb/schema-core';

import type { Users, S } from './fixtures.ts';

declare const repo: Users;

// Verify repo.upsert parameter type equals CreateDTO<S>
type _TestUpsertParam = Expect<Equal<Parameters<typeof repo.upsert>[0], CreateDTO<S>>>;

// Verify repo.upsert return type resolves to Entity<S> | undefined
type _TestUpsertReturn = Expect<Equal<Awaited<ReturnType<typeof repo.upsert>>, Entity<S> | undefined>>;
