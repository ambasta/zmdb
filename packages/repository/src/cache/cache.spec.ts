import type { CompiledQuery, SqlDialect } from '@zmdb/query-compiler';
import type { DeclaredTable, Entity, PrimaryKeyOf } from '@zmdb/schema-core';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it, vi } from 'vitest';

import {
  BaseRepository,
  memoryStore,
  type CacheOptions,
  type CacheStore,
  type Driver,
  type RepositoryOptions,
} from '../index.js';
import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { resultCacheKey } from './index.js';

function findByIdWithCache<T extends DeclaredTable>(
  repository: BaseRepository<T>,
  id: PrimaryKeyOf<T>,
  cache: CacheOptions | false,
): Promise<Entity<T> | undefined> {
  return repository.findById(id, { cache });
}

function findByIdWithUntypedCache<Row>(
  repository: object,
  id: unknown,
  cache: CacheOptions | false,
): Promise<Row | undefined> {
  const method: unknown = Reflect.get(repository, 'findById');
  if (typeof method !== 'function') throw new TypeError('BaseRepository.findById is not a function');
  return Reflect.apply(method, repository, [id, { cache }]) as Promise<Row | undefined>;
}

type RepositoryConstructor<T extends DeclaredTable> = new (
  driver: Driver,
  dialect?: SqlDialect,
  options?: RepositoryOptions,
) => BaseRepository<T>;

function repositoryWithStore<T extends DeclaredTable>(
  Repository: RepositoryConstructor<T>,
  driver: Driver,
  store: CacheStore,
  dialect: SqlDialect = postgresDialect,
): BaseRepository<T> {
  return new Repository(driver, dialect, { cacheStore: store });
}

export interface CacheUser extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'>;
  visits: number & Sql<'integer'>;
}

export interface CacheUserV2 extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'>;
  visits: number & Sql<'integer'>;
  role: string & Sql<'text'>;
}

export interface CacheOrganization extends Table<'organizations'> {
  id: number & Sql<'integer'> & PrimaryKey;
  name: string & Sql<'text'>;
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
  columns: [column('id', 'integer', { primaryKey: true }), column('email', 'text'), column('visits', 'integer')],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

const USER_V2_IR: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [...USER_IR.columns, column('role', 'text')],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

const ORGANIZATION_IR: SchemaIR = {
  table: 'organizations',
  physicalTable: 'organizations',
  columns: [column('id', 'integer', { primaryKey: true }), column('name', 'text')],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

const UserSchema = schemaFromIR(USER_IR);
const UserV2Schema = schemaFromIR(USER_V2_IR);
const OrganizationSchema = schemaFromIR(ORGANIZATION_IR);

class Users extends BaseRepository<CacheUser> {
  static override readonly schema = UserSchema;
}

class UsersV2 extends BaseRepository<CacheUserV2> {
  static override readonly schema = UserV2Schema;
}

class Organizations extends BaseRepository<CacheOrganization> {
  static override readonly schema = OrganizationSchema;
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
    dialect: postgresDialect,
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
  it('serves a second identical query from the cache', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver((_query, call) => [{ id: 1, email: `database-${call + 1}@example.com`, visits: 0 }]);
    const repository = repositoryWithStore(Users, driver, tracked.store);

    const first = await findByIdWithCache<CacheUser>(repository, 1, CACHE);
    expect(first).toEqual({ id: 1, email: 'database-1@example.com', visits: 0 });
    if (first !== undefined) first.email = 'caller-mutated@example.com';
    const second = await findByIdWithCache<CacheUser>(repository, 1, CACHE);

    expect(first?.email).toBe('caller-mutated@example.com');
    expect(second).toEqual({ id: 1, email: 'database-1@example.com', visits: 0 });
    expect(second).not.toBe(first);
    expect(driver.calls).toHaveLength(1);
    expect(tracked.gets).toHaveLength(2);
    expect(tracked.sets).toHaveLength(1);
  });

  // Four reads leave two database calls only when the key distinguishes the
  // number 1 from the string "1" and then reuses each exact typed key.
  it('treats a differently-typed parameter as a different key', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver(query => {
      const id = query.parameters[0];
      return [{ id, email: `${typeof id}-${String(id)}@example.com`, visits: 0 }];
    });
    const repository = repositoryWithStore(Users, driver, tracked.store);

    await findByIdWithUntypedCache(repository, 1, CACHE);
    await findByIdWithUntypedCache(repository, '1', CACHE);
    await findByIdWithUntypedCache(repository, 1, CACHE);
    await findByIdWithUntypedCache(repository, '1', CACHE);

    expect(driver.calls).toHaveLength(2);
    expect(tracked.gets).toHaveLength(4);
    expect(tracked.gets[0]).toBe(tracked.gets[2]);
    expect(tracked.gets[1]).toBe(tracked.gets[3]);
    expect(tracked.gets[0]).not.toBe(tracked.gets[1]);
    expect(tracked.gets[0]).toContain('n:1');
    expect(tracked.gets[1]).toContain('s:1');
  });

  it('serializes object parameters in stable key order', () => {
    const keyFor = (parameter: unknown) =>
      resultCacheKey({
        dialect: postgresDialect,
        schema: USER_IR,
        table: 'users',
        query: { text: 'SELECT $1', parameters: [parameter] },
      });

    expect(keyFor({ b: 2, a: 1 })).toBe(keyFor({ a: 1, b: 2 }));
    expect(keyFor({ a: 1 })).not.toBe(keyFor({ a: '1' }));
    expect(keyFor(-0)).toBe(keyFor(0));
    expect(keyFor(new Uint8Array([1]))).not.toBe(keyFor(new Int8Array([1])));
    expect(keyFor(new Uint8Array([1]).buffer)).not.toBe(keyFor(new Uint8Array([1])));
  });

  // The clock is advanced explicitly; no sleep or scheduler race participates.
  it('expires a cached result after its TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    try {
      const tracked = recordingStore(memoryStore());
      const driver = recordingDriver((_query, call) => [
        { id: 1, email: `database-${call + 1}@example.com`, visits: 0 },
      ]);
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

  it('evicts by LRU at maxEntries', async () => {
    const store = memoryStore({ maxEntries: 2 });

    await store.set('first', 1, 60_000, []);
    await store.set('second', 2, 60_000, []);
    await expect(store.get('first')).resolves.toBe(1);
    await store.set('third', 3, 60_000, []);

    await expect(store.get('first')).resolves.toBe(1);
    await expect(store.get('second')).resolves.toBeUndefined();
    await expect(store.get('third')).resolves.toBe(3);

    const boundedDefault = memoryStore();
    for (let index = 0; index <= 1_000; index++) {
      await boundedDefault.set(`key:${String(index)}`, index, 60_000, []);
    }
    await expect(boundedDefault.get('key:0')).resolves.toBeUndefined();
    await expect(boundedDefault.get('key:1000')).resolves.toBe(1_000);
  });

  it('invalidates by tag on a write to the table', async () => {
    const tracked = recordingStore(memoryStore());
    let email = 'before@example.com';
    const driver = recordingDriver(query => {
      if (query.text.startsWith('UPDATE ')) {
        email = String(query.parameters[0]);
      }
      return [{ id: 1, email, visits: 0 }];
    });
    const repository = repositoryWithStore(Users, driver, tracked.store);
    const cache = { ttlMs: 60_000, tags: ['user:1'] };

    const before = await findByIdWithCache<CacheUser>(repository, 1, cache);
    await repository.update(1, { email: 'after@example.com' }, { invalidateTags: ['user:1'] });
    const after = await findByIdWithCache<CacheUser>(repository, 1, cache);

    expect([before?.email, after?.email]).toEqual(['before@example.com', 'after@example.com']);
    expect(driver.calls.map(query => query.text.split(' ', 1)[0])).toEqual(['SELECT', 'UPDATE', 'SELECT']);
    expect(tracked.sets[0]?.tags).toEqual(expect.arrayContaining(['user:1', 'table:users']));
    expect(tracked.invalidations).toContainEqual(['table:users', 'user:1']);
  });

  it('invalidates table and caller tags after every successful write', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver(query =>
      query.text.startsWith('DELETE ') ? [] : [{ id: 1, email: 'written@example.com', visits: 1 }],
    );
    const repository = repositoryWithStore(Users, driver, tracked.store);

    await repository.create({ id: 1, email: 'created@example.com', visits: 0 }, { invalidateTags: ['write:create'] });
    await repository.upsert(
      { id: 1, email: 'upserted@example.com', visits: 0 },
      { target: 'id', updateFields: ['email'], invalidateTags: ['write:upsert'] },
    );
    await repository.update(1, { email: 'updated@example.com' }, { invalidateTags: ['write:update'] });
    await repository.updateMany(
      { email: 'updated@example.com' },
      { email: 'many@example.com' },
      { invalidateTags: ['write:updateMany'] },
    );
    await repository.increment(1, 'visits', 1, { invalidateTags: ['write:increment'] });
    await expect(repository.delete(1, { invalidateTags: ['write:delete'] })).resolves.toBe(false);

    expect(tracked.invalidations).toEqual([
      ['table:users', 'write:create'],
      ['table:users', 'write:upsert'],
      ['table:users', 'write:update'],
      ['table:users', 'write:updateMany'],
      ['table:users', 'write:increment'],
      ['table:users', 'write:delete'],
    ]);
  });

  it('invalidates a caller tag across repositories sharing a store', async () => {
    const shared = memoryStore();
    const userDriver = recordingDriver((_query, call) => [
      { id: 1, email: `database-${String(call + 1)}@example.com`, visits: 0 },
    ]);
    const organizationDriver = recordingDriver(() => [{ id: 7, name: 'renamed' }]);
    const users = repositoryWithStore(Users, userDriver, shared);
    const organizations = repositoryWithStore(Organizations, organizationDriver, shared);

    const before = await findByIdWithCache<CacheUser>(users, 1, { ttlMs: 60_000, tags: ['organization:7'] });
    await organizations.update(7, { name: 'renamed' }, { invalidateTags: ['organization:7'] });
    const after = await findByIdWithCache<CacheUser>(users, 1, { ttlMs: 60_000, tags: ['organization:7'] });

    expect([before?.email, after?.email]).toEqual(['database-1@example.com', 'database-2@example.com']);
    expect(userDriver.calls).toHaveLength(2);
    expect(organizationDriver.calls).toHaveLength(1);
  });

  it('does not cache anything when no cache option is given', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver(() => [{ id: 1, email: 'uncached@example.com', visits: 0 }]);
    const repository = repositoryWithStore(Users, driver, tracked.store);

    const row = await repository.findById(1);

    expect(row).toEqual({ id: 1, email: 'uncached@example.com', visits: 0 });
    expect(driver.calls).toHaveLength(1);
    expect(tracked.gets).toEqual([]);
    expect(tracked.sets).toEqual([]);
    expect(tracked.invalidations).toEqual([]);
  });

  it('bypasses an existing cache in both directions when cache is false', async () => {
    const tracked = recordingStore(memoryStore());
    const driver = recordingDriver((_query, call) => [
      { id: 1, email: `database-${String(call + 1)}@example.com`, visits: 0 },
    ]);
    const repository = repositoryWithStore(Users, driver, tracked.store);

    const cached = await findByIdWithCache<CacheUser>(repository, 1, CACHE);
    const bypassed = await findByIdWithCache<CacheUser>(repository, 1, false);
    const cachedAgain = await findByIdWithCache<CacheUser>(repository, 1, CACHE);

    expect([cached?.email, bypassed?.email, cachedAgain?.email]).toEqual([
      'database-1@example.com',
      'database-2@example.com',
      'database-1@example.com',
    ]);
    expect(driver.calls).toHaveLength(2);
    expect(tracked.gets).toHaveLength(2);
    expect(tracked.sets).toHaveLength(1);
  });

  it('owns the default memory store per repository instance', async () => {
    const firstDriver = recordingDriver(() => [{ id: 1, email: 'first@example.com', visits: 0 }]);
    const secondDriver = recordingDriver(() => [{ id: 1, email: 'second@example.com', visits: 0 }]);
    const first = new Users(firstDriver);
    const second = new Users(secondDriver);

    const values = [
      await findByIdWithCache<CacheUser>(first, 1, CACHE),
      await findByIdWithCache<CacheUser>(first, 1, CACHE),
      await findByIdWithCache<CacheUser>(second, 1, CACHE),
      await findByIdWithCache<CacheUser>(second, 1, CACHE),
    ];

    expect(values.map(value => value?.email)).toEqual([
      'first@example.com',
      'first@example.com',
      'second@example.com',
      'second@example.com',
    ]);
    expect(firstDriver.calls).toHaveLength(1);
    expect(secondDriver.calls).toHaveLength(1);
  });

  it('falls through to the database when the store throws, and reports once', async () => {
    const failure = new Error('cache unavailable');
    const store: CacheStore = {
      get: async () => Promise.reject(failure),
      set: async () => Promise.reject(failure),
      invalidateTags: async () => Promise.reject(failure),
    };
    const driver = recordingDriver((_query, call) => [
      { id: 1, email: `database-${String(call + 1)}@example.com`, visits: 0 },
    ]);
    const repository = repositoryWithStore(Users, driver, store);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const first = await findByIdWithCache<CacheUser>(repository, 1, CACHE);
      const second = await findByIdWithCache<CacheUser>(repository, 1, CACHE);

      expect([first?.email, second?.email]).toEqual(['database-1@example.com', 'database-2@example.com']);
      expect(driver.calls).toHaveLength(2);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith(
        '@zmdb/repository cache store failed; continuing on the database path',
        failure,
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps database reads and writes available when store set or invalidation fails', async () => {
    const failure = new Error('cache unavailable');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const setDriver = recordingDriver((_query, call) => [
        { id: 1, email: `database-${String(call + 1)}@example.com`, visits: 0 },
      ]);
      const setFailureStore: CacheStore = {
        get: async () => undefined,
        set: async () => Promise.reject(failure),
        invalidateTags: async () => undefined,
      };
      const setFailureRepository = repositoryWithStore(Users, setDriver, setFailureStore);

      await findByIdWithCache<CacheUser>(setFailureRepository, 1, CACHE);
      await findByIdWithCache<CacheUser>(setFailureRepository, 1, CACHE);

      const invalidationDriver = recordingDriver(() => [{ id: 1, email: 'updated@example.com', visits: 0 }]);
      const invalidationFailureStore: CacheStore = {
        get: async () => undefined,
        set: async () => undefined,
        invalidateTags: async () => Promise.reject(failure),
      };
      const invalidationFailureRepository = repositoryWithStore(Users, invalidationDriver, invalidationFailureStore);

      await expect(
        invalidationFailureRepository.update(1, { email: 'updated@example.com' }, { invalidateTags: ['user:1'] }),
      ).resolves.toEqual({ id: 1, email: 'updated@example.com', visits: 0 });
      await invalidationFailureRepository.update(
        1,
        { email: 'updated-again@example.com' },
        { invalidateTags: ['user:1'] },
      );

      expect(setDriver.calls).toHaveLength(2);
      expect(invalidationDriver.calls).toHaveLength(2);
      expect(warning).toHaveBeenCalledTimes(2);
    } finally {
      warning.mockRestore();
    }
  });

  // The generated issue title predates #465's accepted decision. The frozen
  // behavior is no database re-validation for a same-fingerprint shared value;
  // changing the schema fingerprint makes the same SQL and params miss instead.
  //
  it('misses a shared-store value when the schema fingerprint changes', async () => {
    const tracked = recordingStore(memoryStore());
    const writerDriver = recordingDriver(() => [{ id: 1, email: 'old@example.com', visits: 0 }]);
    const writer = repositoryWithStore(Users, writerDriver, tracked.store);

    const written = await findByIdWithCache<CacheUser>(writer, 1, CACHE);

    const sameSchemaDriver = recordingDriver(() => {
      throw new Error('same-fingerprint cache hit must not re-validate against the database');
    });
    const reader = repositoryWithStore(Users, sameSchemaDriver, tracked.store);
    const shared = await findByIdWithCache<CacheUser>(reader, 1, CACHE);

    const changedSchemaDriver = recordingDriver(() => [{ id: 1, email: 'new@example.com', visits: 0, role: 'admin' }]);
    const changedReader = repositoryWithStore(UsersV2, changedSchemaDriver, tracked.store);
    const changed = await findByIdWithCache<CacheUserV2>(changedReader, 1, CACHE);

    expect(written).toEqual({ id: 1, email: 'old@example.com', visits: 0 });
    expect(shared).toEqual(written);
    expect(sameSchemaDriver.calls).toEqual([]);
    expect(changed).toEqual({ id: 1, email: 'new@example.com', visits: 0, role: 'admin' });
    expect(changedSchemaDriver.calls).toHaveLength(1);
    expect(tracked.gets).toHaveLength(3);
    expect(tracked.gets[0]).toBe(tracked.gets[1]);
    expect(tracked.gets[2]).not.toBe(tracked.gets[0]);
    expect(tracked.sets).toHaveLength(2);
  });
});
