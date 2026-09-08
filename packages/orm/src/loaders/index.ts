import { type DeclaredTable, type Entity, type PrimaryKeyOf } from '@zmdb/schema';
import { type Populated, type RelationKeys, type RelationPath } from '@zmdb/schema/derive';

import { type BaseRepository, type ReadOptions } from '../index.js';

/** One explicit, request-lifetime loader for a repository's primary key. */
export interface EntityLoader<T extends DeclaredTable> {
  load(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
}

/** The populated value attached under one declared relation name. */
export type RelationValueOf<T extends DeclaredTable, K extends RelationKeys<T>> = Populated<T, K>[K];

/** One explicit, request-lifetime loader for a declared relation. */
export interface RelationLoader<T extends DeclaredTable, K extends RelationKeys<T>> {
  load(parent: Entity<T>): Promise<RelationValueOf<T, K>>;
}

export interface LoaderScope {
  loaderFor<T extends DeclaredTable>(repository: BaseRepository<T>): EntityLoader<T>;
  relationLoader<T extends DeclaredTable, K extends RelationKeys<T> & string>(
    repository: BaseRepository<T>,
    relation: K,
  ): RelationLoader<T, K>;
  populate<T extends DeclaredTable, K extends string>(
    repository: BaseRepository<T>,
    rows: readonly Entity<T>[],
    paths: readonly (K & RelationPath<T, K>)[],
    options?: ReadOptions,
  ): Promise<readonly Populated<T, RelationPath<T, K>>[]>;
  populate<T extends DeclaredTable, K extends string>(
    repository: BaseRepository<T>,
    row: Entity<T>,
    paths: readonly (K & RelationPath<T, K>)[],
    options?: ReadOptions,
  ): Promise<Populated<T, RelationPath<T, K>>>;
}

interface PopulateRequest {
  readonly rows: readonly object[];
  readonly resolve: (rows: readonly object[]) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * Internal repository hooks. They are symbols so the loader can reuse the
 * repository's schema, decoding, relation resolution and dialect limits without
 * widening the public method surface with a second family of read operations.
 */
export const LOADER_FOR_SCOPE = Symbol('zmdb.loaderForScope');
export const RELATION_LOADER_FOR_SCOPE = Symbol('zmdb.relationLoaderForScope');
export const LOADER_ENTITY_KEY = Symbol('zmdb.loaderEntityKey');
export const LOADER_ENTITY_BATCH = Symbol('zmdb.loaderEntityBatch');
export const LOADER_RELATION_KEY = Symbol('zmdb.loaderRelationKey');
export const LOADER_RELATION_BATCH = Symbol('zmdb.loaderRelationBatch');

interface BatchWaiter<Value> {
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: unknown) => void;
}

interface BatchEntry<Input, Value> {
  readonly input: Input;
  readonly waiters: BatchWaiter<Value>[];
}

interface BatchLoader<Input, Value> {
  load(input: Input): Promise<Value>;
}

/**
 * One-microtask batching with a request-lifetime result map.
 *
 * `inFlight` matters for a duplicate that arrives after dispatch but before the
 * driver answers: it joins the dispatched entry instead of opening a second
 * query. Errors are deliberately not cached, so a later call may retry.
 */
function createBatchLoader<Input, Value>(
  keyOf: (input: Input) => string,
  dispatch: (inputs: readonly Input[]) => Promise<readonly Value[]>,
  copy: (value: Value) => Value,
): BatchLoader<Input, Value> {
  const cache = new Map<string, { readonly value: Value }>();
  let pending = new Map<string, BatchEntry<Input, Value>>();
  const inFlight = new Map<string, BatchEntry<Input, Value>>();
  let scheduled = false;

  const flush = async (): Promise<void> => {
    scheduled = false;
    const batch = pending;
    pending = new Map();
    const entries = [...batch.entries()];
    for (const [key, entry] of entries) inFlight.set(key, entry);

    try {
      const values = await dispatch(entries.map(([, entry]) => entry.input));
      if (values.length !== entries.length) {
        throw new Error(`loader batch returned ${values.length} result(s) for ${entries.length} key(s)`);
      }

      const results = values.map(value => ({ value }));
      for (let index = 0; index < entries.length; index++) {
        const keyed = entries[index];
        const result = results[index];
        if (!keyed || !result) throw new Error(`loader batch omitted result ${index}`);
        const [key, entry] = keyed;
        cache.set(key, result);
        for (const waiter of entry.waiters) waiter.resolve(copy(result.value));
      }
    } catch (error) {
      for (const [, entry] of entries) {
        for (const waiter of entry.waiters) waiter.reject(error);
      }
    } finally {
      for (const [key] of entries) inFlight.delete(key);
    }
  };

  const enqueue = (input: Input): Promise<Value> => {
    const key = keyOf(input);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(copy(cached.value));

    return new Promise<Value>((resolve, reject) => {
      const active = inFlight.get(key) ?? pending.get(key);
      if (active) {
        active.waiters.push({ resolve, reject });
        return;
      }

      pending.set(key, { input, waiters: [{ resolve, reject }] });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => void flush());
      }
    });
  };

  return {
    async load(input) {
      return enqueue(input);
    },
  };
}

function copyEntity<Row extends object>(row: Row | undefined): Row | undefined {
  return row === undefined ? undefined : { ...row };
}

function copyRelation<Value extends object | readonly object[] | null>(value: Value): Value;
function copyRelation(value: object | readonly object[] | null): object | readonly object[] | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(item => ({ ...item }));
  return { ...value };
}

export function createEntityLoader<T extends DeclaredTable>(repository: BaseRepository<T>): EntityLoader<T> {
  return createBatchLoader(
    id => repository[LOADER_ENTITY_KEY](id),
    ids => repository[LOADER_ENTITY_BATCH](ids),
    copyEntity,
  );
}

export function createRelationLoader<T extends DeclaredTable, K extends RelationKeys<T> & string>(
  repository: BaseRepository<T>,
  relation: K,
): RelationLoader<T, K> {
  return createBatchLoader(
    parent => repository[LOADER_RELATION_KEY](parent, relation),
    parents => repository[LOADER_RELATION_BATCH](parents, relation),
    copyRelation,
  );
}

/**
 * Construct this at the request boundary and pass it explicitly. There is no
 * default, module-global or ambient scope.
 */
export function createLoaderScope(): LoaderScope {
  const token = {};
  const pending = new WeakMap<object, Map<string, Map<ReadOptions | undefined, PopulateRequest[]>>>();

  function populate<T extends DeclaredTable, K extends string>(
    repository: BaseRepository<T>,
    rows: readonly Entity<T>[],
    paths: readonly (K & RelationPath<T, K>)[],
    options?: ReadOptions,
  ): Promise<readonly Populated<T, RelationPath<T, K>>[]>;
  function populate<T extends DeclaredTable, K extends string>(
    repository: BaseRepository<T>,
    row: Entity<T>,
    paths: readonly (K & RelationPath<T, K>)[],
    options?: ReadOptions,
  ): Promise<Populated<T, RelationPath<T, K>>>;
  function populate<T extends DeclaredTable, K extends string>(
    repository: BaseRepository<T>,
    rowOrRows: Entity<T> | readonly Entity<T>[],
    paths: readonly (K & RelationPath<T, K>)[],
    options?: ReadOptions,
  ): Promise<Populated<T, RelationPath<T, K>> | readonly Populated<T, RelationPath<T, K>>[]> {
    const allPaths = [...new Set(paths)].toSorted();
    const canonical = allPaths.filter(path => !allPaths.some(other => other.startsWith(`${path}.`)));
    const key = JSON.stringify(canonical);
    let byPath = pending.get(repository);
    if (byPath === undefined) {
      byPath = new Map();
      pending.set(repository, byPath);
    }
    let byOptions = byPath.get(key);
    if (byOptions === undefined) {
      byOptions = new Map();
      byPath.set(key, byOptions);
    }
    const isMany = Array.isArray(rowOrRows);
    return new Promise((resolve, reject) => {
      const request: PopulateRequest = {
        rows: isMany ? rowOrRows : [rowOrRows],
        // The grouping key preserves repository identity, so every request has this T.
        resolve: rows =>
          resolve(
            (isMany ? rows : rows[0]) as Populated<T, RelationPath<T, K>> | readonly Populated<T, RelationPath<T, K>>[],
          ),
        reject,
      };
      const existing = byOptions.get(options);
      if (existing !== undefined) {
        existing.push(request);
        return;
      }
      const requests = [request];
      byOptions.set(options, requests);
      queueMicrotask(async () => {
        byOptions.delete(options);
        if (byOptions.size === 0) byPath.delete(key);
        try {
          const roots = requests.flatMap(entry => entry.rows) as readonly Entity<T>[];
          const rows = await repository.populate<K>(roots, canonical, options);
          let offset = 0;
          for (const entry of requests) {
            entry.resolve(rows.slice(offset, offset + entry.rows.length));
            offset += entry.rows.length;
          }
        } catch (error) {
          for (const entry of requests) entry.reject(error);
        }
      });
    });
  }

  return {
    loaderFor: repository => repository[LOADER_FOR_SCOPE](token),
    relationLoader: (repository, relation) => repository[RELATION_LOADER_FOR_SCOPE](token, relation),
    populate,
  };
}
