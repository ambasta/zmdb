import type { BaseRepository } from '@zmdb/repository';
import type { DeclaredTable } from '@zmdb/schema-core';

import { createToken, type Token } from '../di/index.js';

/** A typed repository token shared by HTTP, jobs and command applications. */
export function repositoryToken<T extends DeclaredTable>(name: string): Token<BaseRepository<T>> {
  return createToken<BaseRepository<T>>(name);
}
