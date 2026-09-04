import type { CompiledQuery, Dialect } from '@zmdb/query-compiler';
import type { DeclaredTable } from '@zmdb/schema-core';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it, vi } from 'vitest';

import { BaseRepository, type Driver } from '../index.js';

// Tests freeze for #466, against repository/SPEC.md §3d.
//
// The cache exports and repository integration do not exist at d34bfbaf. These
// local types transcribe the frozen store and read-option shapes. The constructor
// boundary extends the existing per-repository options seam with `cacheStore`;
// it supplies no implementation, and today's constructor simply ignores it.
interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number, tags: readonly string[]): Promise<void>;
  invalidateTags(tags: readonly string[]): Promise<void>;
}

interface CacheOptions {
  readonly ttlMs: number;
  readonly tags?: readonly string[];
}

interface FrozenRepositoryOptions {
  readonly cacheStore: CacheStore;
}

const repositoryApi: object = await import('../index.js');

function memoryStore(options?: { readonly maxEntries?: number }): CacheStore {
  const candidate: unknown = Reflect.get(repositoryApi, 'memoryStore');
  if (typeof candidate !== 'function') {
    throw new TypeError('@zmdb/repository exports no "memoryStore"');
  }
  return Reflect.apply(candidate, undefined, options === undefined ? [] : [options]) as CacheStore;
}

function findByIdWithCache<Row>(
  repository: object,
  id: unknown,
  cache: CacheOptions | false,
): Promise<Row | undefined> {
  const method: unknown = Reflect.get(repository, 'findById');
  if (typeof method !== 'function') {
    throw new TypeError('BaseRepository.findById is not a function');
  }
  return Reflect.apply(method, repository, [id, { cache }]) as Promise<Row | undefined>;
}

type RepositoryConstructor<T extends DeclaredTable> = new (driver: Driver, dialect?: Dialect) => BaseRepository<T>;

function repositoryWithStore<T extends DeclaredTable>(
  Repository: RepositoryConstructor<T>,
  driver: Driver,
  store: CacheStore,
  dialect: Dialect = 'postgres',
): BaseRepository<T> {
  return Reflect.construct(Repository, [
    driver,
    dialect,
    { cacheStore: store } satisfies FrozenRepositoryOptions,
  ]) as BaseRepository<T>;
}

export interface CacheUser extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'>;
}

export interface CacheUserV2 extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'>;
  role: string & Sql<'text'>;
}

function column(name: string, sql: ColumnIR['sql'], overrides: Partial<ColumnIR> = {}): ColumnIR {
  return {
    name,
    physicalName: name,
    sql,
    nullable: false,
    primaryKey: false,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    ...overrides,
  };
}

const USER_IR: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [column('id', 'integer', { primaryKey: true }), column('email', 'text')],
  primaryKey: ['id'],
  relations: [],
};

const USER_V2_IR: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [...USER_IR.columns, column('role', 'text')],
  primaryKey: ['id'],
  relations: [],
};

const UserSchema = schemaFromIR(USER_IR);
const UserV2Schema = schemaFromIR(USER_V2_IR);

class Users extends BaseRepository<CacheUser> {
  static override readonly schema = UserSchema;
}

class UsersV2 extends BaseRepository<CacheUserV2> {
  static override readonly schema = UserV2Schema;
}

interface RecordingDriver extends Driver {
  readonly calls: CompiledQuery[];
}

type DriverAnswer = (
  query: CompiledQuery,
  call: number,
) => readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>;

function recordingDriver(answer: DriverAnswer): RecordingDriver {
  const calls: CompiledQuery[] = [];
  return {
    calls,
    async execute(query) {
      const call = calls.length;
      calls.push(query);
      return answer(query, call);
    },
  };
}

interface StoreSet {
  readonly key: string;
  readonly value: unknown;
  readonly ttlMs: number;
  readonly tags: readonly string[];
}

interface RecordingStore {
  readonly store: CacheStore;
  readonly gets: string[];
  readonly sets: StoreSet[];
  readonly invalidations: (readonly string[])[];
}

function recordingStore(inner: CacheStore): RecordingStore {
  const gets: string[] = [];
  const sets: StoreSet[] = [];
  const invalidations: (readonly string[])[] = [];
  return {
    gets,
    sets,
    invalidations,
    store: {
      get(key) {
        gets.push(key);
        return inner.get(key);
      },
      set(key, value, ttlMs, tags) {
        sets.push({ key, value, ttlMs, tags: [...tags] });
        return inner.set(key, value, ttlMs, tags);
      },
      invalidateTags(tags) {
        invalidations.push([...tags]);
        return inner.invalidateTags(tags);
      },
    },
  };
}

const CACHE = { ttlMs: 60_000 } as const;

describe('opt-in repository result cache (frozen: repository/SPEC.md 3d)', () => {
  // Actual at d34bfbaf: @zmdb/repository exports no memoryStore. Without the
  // feature, two identical reads make two recorded database round trips.
  it.fails('serves a second identical query from the cache', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver((_query, call) => [{ id: 1, email: `database-${call + 1}@example.com` }]);
    const repository = repositoryWithStore(Users, driver, tracked.store);

    const first = await findByIdWithCache<CacheUser>(repository, 1, CACHE);
    const second = await findByIdWithCache<CacheUser>(repository, 1, CACHE);

    expect(first).toEqual({ id: 1, email: 'database-1@example.com' });
    expect(second).toEqual(first);
    expect(driver.calls).toHaveLength(1);
    expect(tracked.gets).toHaveLength(2);
    expect(tracked.sets).toHaveLength(1);
  });

  // Actual at d34bfbaf: @zmdb/repository exports no memoryStore.
  // Four reads leave two database calls only when the key distinguishes the
  // number 1 from the string "1" and then reuses each exact typed key.
  it.fails('treats a differently-typed parameter as a different key', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver(query => {
      const id = query.parameters[0];
      return [{ id, email: `${typeof id}-${String(id)}@example.com` }];
    });
    const repository = repositoryWithStore(Users, driver, tracked.store);

    await findByIdWithCache(repository, 1, CACHE);
    await findByIdWithCache(repository, '1', CACHE);
    await findByIdWithCache(repository, 1, CACHE);
    await findByIdWithCache(repository, '1', CACHE);

    expect(driver.calls).toHaveLength(2);
    expect(tracked.gets).toHaveLength(4);
    expect(tracked.gets[0]).toBe(tracked.gets[2]);
    expect(tracked.gets[1]).toBe(tracked.gets[3]);
    expect(tracked.gets[0]).not.toBe(tracked.gets[1]);
    expect(tracked.gets[0]).toContain('n:1');
    expect(tracked.gets[1]).toContain('s:1');
  });

  // Actual at d34bfbaf: @zmdb/repository exports no memoryStore.
  // The clock is advanced explicitly; no sleep or scheduler race participates.
  it.fails('expires a cached result after its TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    try {
      const tracked = recordingStore(memoryStore());
      const driver = recordingDriver((_query, call) => [{ id: 1, email: `database-${call + 1}@example.com` }]);
      const repository = repositoryWithStore(Users, driver, tracked.store);
      const cache = { ttlMs: 100 };

      const first = await findByIdWithCache<CacheUser>(repository, 1, cache);
      vi.advanceTimersByTime(99);
      const beforeExpiry = await findByIdWithCache<CacheUser>(repository, 1, cache);
      vi.advanceTimersByTime(2);
      const afterExpiry = await findByIdWithCache<CacheUser>(repository, 1, cache);

      expect([first?.email, beforeExpiry?.email, afterExpiry?.email]).toEqual([
        'database-1@example.com',
        'database-1@example.com',
        'database-2@example.com',
      ]);
      expect(driver.calls).toHaveLength(2);
      expect(tracked.sets.map(call => call.ttlMs)).toEqual([100, 100]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Actual at d34bfbaf: @zmdb/repository exports no memoryStore. The current
  // repository executes SELECT, UPDATE, SELECT and never calls invalidateTags.
  it.fails('invalidates by tag on a write to the table', async () => {
    const tracked = recordingStore(memoryStore());
    let email = 'before@example.com';
    const driver = recordingDriver(query => {
      if (query.text.startsWith('UPDATE ')) {
        email = String(query.parameters[0]);
      }
      return [{ id: 1, email }];
    });
    const repository = repositoryWithStore(Users, driver, tracked.store);
    const cache = { ttlMs: 60_000, tags: ['user:1'] };

    const before = await findByIdWithCache<CacheUser>(repository, 1, cache);
    await repository.update(1, { email: 'after@example.com' });
    const after = await findByIdWithCache<CacheUser>(repository, 1, cache);

    expect([before?.email, after?.email]).toEqual(['before@example.com', 'after@example.com']);
    expect(driver.calls.map(query => query.text.split(' ', 1)[0])).toEqual(['SELECT', 'UPDATE', 'SELECT']);
    expect(tracked.sets[0]?.tags).toEqual(expect.arrayContaining(['user:1', 'table:users']));
    expect(tracked.invalidations).toContainEqual(['table:users']);
  });

  // Actual at d34bfbaf: @zmdb/repository exports no memoryStore. Calling that
  // missing export keeps this expected-failing today; once the feature exists,
  // the counting store proves the ordinary path performs zero store operations.
  it.fails('does not cache anything when no cache option is given', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver(() => [{ id: 1, email: 'uncached@example.com' }]);
    const repository = repositoryWithStore(Users, driver, tracked.store);

    const row = await repository.findById(1);

    expect(row).toEqual({ id: 1, email: 'uncached@example.com' });
    expect(driver.calls).toHaveLength(1);
    expect(tracked.gets).toEqual([]);
    expect(tracked.sets).toEqual([]);
    expect(tracked.invalidations).toEqual([]);
  });

  // The generated issue title predates #465's accepted decision. The frozen
  // behavior is no database re-validation for a same-fingerprint shared value;
  // changing the schema fingerprint makes the same SQL and params miss instead.
  //
  // Actual at d34bfbaf: @zmdb/repository exports no memoryStore.
  it.fails('misses a shared-store value when the schema fingerprint changes', async () => {
    const tracked = recordingStore(memoryStore());
    const writerDriver = recordingDriver(() => [{ id: 1, email: 'old@example.com' }]);
    const writer = repositoryWithStore(Users, writerDriver, tracked.store);

    const written = await findByIdWithCache<CacheUser>(writer, 1, CACHE);

    const sameSchemaDriver = recordingDriver(() => {
      throw new Error('same-fingerprint cache hit must not re-validate against the database');
    });
    const reader = repositoryWithStore(Users, sameSchemaDriver, tracked.store);
    const shared = await findByIdWithCache<CacheUser>(reader, 1, CACHE);

    const changedSchemaDriver = recordingDriver(() => [{ id: 1, email: 'new@example.com', role: 'admin' }]);
    const changedReader = repositoryWithStore(UsersV2, changedSchemaDriver, tracked.store);
    const changed = await findByIdWithCache<CacheUserV2>(changedReader, 1, CACHE);

    expect(written).toEqual({ id: 1, email: 'old@example.com' });
    expect(shared).toEqual(written);
    expect(sameSchemaDriver.calls).toEqual([]);
    expect(changed).toEqual({ id: 1, email: 'new@example.com', role: 'admin' });
    expect(changedSchemaDriver.calls).toHaveLength(1);
    expect(tracked.gets).toHaveLength(3);
    expect(tracked.gets[0]).toBe(tracked.gets[1]);
    expect(tracked.gets[2]).not.toBe(tracked.gets[0]);
    expect(tracked.sets).toHaveLength(2);
  });
});
