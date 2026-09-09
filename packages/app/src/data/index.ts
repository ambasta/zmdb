import { createLoaderScope, type BaseRepository, type LoaderScope } from '@zmdb/orm';
import { type DeclaredTable } from '@zmdb/schema';

import { createToken, type Token } from '../di/index.js';

/** Data access shared within one request, never across requests. */
export interface RequestData {
  readonly loaders: LoaderScope;
}

const loadersByRequest = new WeakMap<RequestData, LoaderScope>();
const loadersProperty: PropertyDescriptor = {
  configurable: true,
  enumerable: true,
  get(this: RequestData): LoaderScope {
    let loaders = loadersByRequest.get(this);
    if (loaders === undefined) {
      loaders = createLoaderScope();
      loadersByRequest.set(this, loaders);
    }
    return loaders;
  },
};

/** Allocate a loader scope only when the request first uses data loading. */
export function createRequestData(): RequestData {
  return Object.defineProperty({}, 'loaders', loadersProperty) as RequestData;
}

/** A typed repository token shared by HTTP, jobs and command applications. */
export function repositoryToken<T extends DeclaredTable>(name: string): Token<BaseRepository<T>> {
  return createToken<BaseRepository<T>>(name);
}
