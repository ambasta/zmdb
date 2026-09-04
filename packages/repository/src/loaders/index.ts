import type { DeclaredTable, Entity, PrimaryKeyOf } from '@zmdb/schema-core';
import type { Populated, RelationKeys } from '@zmdb/schema-core/derive';

import type { BaseRepository } from '../index.js';

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
  return {
    loaderFor: repository => repository[LOADER_FOR_SCOPE](token),
    relationLoader: (repository, relation) => repository[RELATION_LOADER_FOR_SCOPE](token, relation),
  };
}
