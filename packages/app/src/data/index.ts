import { createLoaderScope, type BaseRepository, type LoaderScope } from '@zmdb/orm';
import { type DeclaredTable } from '@zmdb/schema';

import { createToken, type Token } from '../di/index.js';

/** Data access shared within one request, never across requests. */
export interface RequestData {
  readonly loaders: LoaderScope;
}

/** Allocate a loader scope only when the request first uses data loading. */
export function createRequestData(): RequestData {
  let loaders: LoaderScope | undefined;
  return {
    get loaders() {
      return (loaders ??= createLoaderScope());
    },
  };
}

/** A typed repository token shared by HTTP, jobs and command applications. */
export function repositoryToken<T extends DeclaredTable>(name: string): Token<BaseRepository<T>> {
  return createToken<BaseRepository<T>>(name);
}
