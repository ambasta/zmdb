import { DIALECT_PARAM_LIMITS, type CompiledQuery } from '@zmdb/query-compiler';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { OneToMany, OneToOne, PrimaryKey, References, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { BaseRepository, createLoaderScope, type Driver } from '../index.js';

export interface LoaderUser extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'>;
  orders?: LoaderOrder[] & OneToMany<'orders', 'userId'>;
  profile?: LoaderProfile & OneToOne<'profiles', 'userId'>;
}

export interface LoaderOrder extends Table<'orders'> {
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'integer'>;
}

export interface LoaderProfile extends Table<'profiles'> {
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  bio: string & Sql<'text'>;
}

export interface LoaderMembership extends Table<'memberships'> {
  tenantId: string & Sql<'text'> & PrimaryKey;
  userId: number & Sql<'integer'> & PrimaryKey;
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
  relations: [
    { name: 'orders', relation: 'oneToMany', target: 'orders', via: 'userId' },
    { name: 'profile', relation: 'oneToOne', target: 'profiles', via: 'userId' },
  ],
  foreignKeys: [],
};

const UserSchema = schemaFromIR(USER_IR);

const MEMBERSHIP_IR: SchemaIR = {
  table: 'memberships',
  physicalTable: 'memberships',
  columns: [
    column('tenantId', 'text', { primaryKey: true }),
    column('userId', 'integer', { primaryKey: true }),
    column('role', 'text'),
  ],
  primaryKey: ['tenantId', 'userId'],
  relations: [],
  foreignKeys: [],
};

const MembershipSchema = schemaFromIR(MEMBERSHIP_IR);

class Users extends BaseRepository<LoaderUser> {
  static override readonly schema = UserSchema;
}

class Memberships extends BaseRepository<LoaderMembership> {
  static override readonly schema = MembershipSchema;
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

function rowsForIds(query: CompiledQuery): readonly Record<string, unknown>[] {
  return query.parameters.map(id => ({ id, email: `user-${String(id)}@example.com` }));
}

function rowsForMemberships(query: CompiledQuery): readonly Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < query.parameters.length; index += 2) {
    const tenantId = query.parameters[index];
    const userId = query.parameters[index + 1];
    rows.push({ tenantId, userId, role: `${String(tenantId)}-${String(userId)}` });
  }
  return rows;
}

describe('request-scoped dataloaders (repository/SPEC.md 3d)', () => {
  // The recording driver is the oracle: 100 synchronous loads produce one
  // dispatch with one IN statement, independent of machine or event-loop timing.
  it('coalesces findById calls in one tick into a single IN query', async () => {
    const driver = recordingDriver(rowsForIds);
    const loader = createLoaderScope().loaderFor(new Users(driver));
    const ids = Array.from({ length: 100 }, (_, index) => index + 1);

    const rows = await Promise.all(ids.map(id => loader.load(id)));

    expect(rows.map(row => row?.id)).toEqual(ids);
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]?.text).toContain(' IN (');
    expect(driver.calls[0]?.parameters).toEqual(ids);
  });

  // The accepted #465 spec corrected the generated issue: duplicate callers get
  // structurally equal fresh shallow copies, not one shared entity reference.
  it('fetches a duplicated id once and resolves both callers', async () => {
    const driver = recordingDriver(rowsForIds);
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const [first, second] = await Promise.all([loader.load(7), loader.load(7)]);

    expect(first).toEqual({ id: 7, email: 'user-7@example.com' });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]?.parameters).toEqual([7]);

    const zeroDriver = recordingDriver(query => query.parameters.map(() => ({ id: 0, email: 'user-0@example.com' })));
    const zeroLoader = createLoaderScope().loaderFor(new Users(zeroDriver));

    const [negativeZero, zero] = await Promise.all([zeroLoader.load(-0), zeroLoader.load(0)]);

    expect(negativeZero).toEqual({ id: 0, email: 'user-0@example.com' });
    expect(zero).toEqual(negativeZero);
    expect(zero).not.toBe(negativeZero);
    expect(zeroDriver.calls).toHaveLength(1);
    expect(Object.is(zeroDriver.calls[0]?.parameters[0], -0)).toBe(true);
  });

  it('resolves undefined for an id the batch did not return', async () => {
    const driver = recordingDriver(query => rowsForIds(query).filter(row => row.id !== 2));
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const rows = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);

    expect(rows).toEqual([{ id: 1, email: 'user-1@example.com' }, undefined, { id: 3, email: 'user-3@example.com' }]);
    expect(driver.calls).toHaveLength(1);
  });

  it('rejects every call in a batch when the driver errors', async () => {
    const failure = new Error('database unavailable');
    const driver = recordingDriver((query, call) => (call === 0 ? Promise.reject(failure) : rowsForIds(query)));
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const settled = await Promise.allSettled([loader.load(1), loader.load(2), loader.load(3)]);

    expect(settled).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(driver.calls).toHaveLength(1);

    await expect(loader.load(1)).resolves.toEqual({ id: 1, email: 'user-1@example.com' });
    expect(driver.calls).toHaveLength(2);
  });

  // Two explicit scope objects are the security boundary. Sharing the repository
  // is deliberate: only the scopes differ, so two calls prove no row leaked.
  it('does not share loaded rows between two scopes', async () => {
    const driver = recordingDriver(rowsForIds);
    const repository = new Users(driver);
    const firstLoader = createLoaderScope().loaderFor(repository);
    const secondLoader = createLoaderScope().loaderFor(repository);

    const first = await firstLoader.load(42);
    const second = await secondLoader.load(42);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(driver.calls).toHaveLength(2);
    expect(driver.calls.map(query => query.parameters)).toEqual([[42], [42]]);
  });

  // Awaiting an already-resolved promise yields to the microtask queue. The first
  // scheduled flush must therefore run before the second load; no timer is used.
  it('does not batch across ticks', async () => {
    const driver = recordingDriver(rowsForIds);
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const first = loader.load(1);
    await Promise.resolve();
    const second = loader.load(2);

    expect(await Promise.all([first, second])).toEqual([
      { id: 1, email: 'user-1@example.com' },
      { id: 2, email: 'user-2@example.com' },
    ]);
    expect(driver.calls).toHaveLength(2);
    expect(driver.calls.map(query => query.parameters)).toEqual([[1], [2]]);
  });

  it('reuses a loaded id inside one scope without sharing the cached row object', async () => {
    const driver = recordingDriver(rowsForIds);
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const first = await loader.load(9);
    if (first) Reflect.set(first, 'email', 'mutated@example.com');
    const second = await loader.load(9);

    expect(first).not.toBe(second);
    expect(second).toEqual({ id: 9, email: 'user-9@example.com' });
    expect(driver.calls).toHaveLength(1);
  });

  it('chunks a batch that would exceed the dialect parameter limit', async () => {
    const driver = recordingDriver(rowsForIds);
    const loader = createLoaderScope().loaderFor(new Users(driver, 'sqlite'));
    const ids = Array.from({ length: DIALECT_PARAM_LIMITS.sqlite + 1 }, (_, index) => index + 1);

    const rows = await Promise.all(ids.map(id => loader.load(id)));

    expect(rows).toHaveLength(ids.length);
    expect(driver.calls).toHaveLength(2);
    expect(driver.calls.map(query => query.parameters.length)).toEqual([DIALECT_PARAM_LIMITS.sqlite, 1]);
  });

  it('batches composite primary keys without crossing tuple boundaries', async () => {
    const driver = recordingDriver(rowsForMemberships);
    const loader = createLoaderScope().loaderFor(new Memberships(driver));
    const keys = [
      { tenantId: 'acme', userId: 1 },
      { userId: 1, tenantId: 'acme' },
      { tenantId: 'globex', userId: 2 },
    ];

    const rows = await Promise.all(keys.map(key => loader.load(key)));

    expect(rows).toEqual([
      { tenantId: 'acme', userId: 1, role: 'acme-1' },
      { tenantId: 'acme', userId: 1, role: 'acme-1' },
      { tenantId: 'globex', userId: 2, role: 'globex-2' },
    ]);
    expect(rows[0]).not.toBe(rows[1]);
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]).toEqual({
      text: 'SELECT * FROM "memberships" WHERE "tenantId" = $1 AND "userId" = $2 OR "tenantId" = $3 AND "userId" = $4',
      parameters: ['acme', 1, 'globex', 2],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
  });

  it('coalesces declared relations across parents with their cardinality', async () => {
    const driver = recordingDriver(query => {
      if (query.text.includes('"profiles"')) {
        return query.parameters
          .filter(userId => userId !== 2)
          .map(userId => ({ id: Number(userId) * 100, userId, bio: `profile-${String(userId)}` }));
      }
      return query.parameters.map(userId => ({
        id: Number(userId) * 10,
        userId,
        total: Number(userId) * 100,
      }));
    });
    const scope = createLoaderScope();
    const repository = new Users(driver);
    const orders = scope.relationLoader(repository, 'orders');
    const profiles = scope.relationLoader(repository, 'profile');
    const parents = [
      { id: 1, email: 'one@example.com' },
      { id: 2, email: 'two@example.com' },
      { id: 3, email: 'three@example.com' },
    ];

    const [orderRows, profileRows] = await Promise.all([
      Promise.all(parents.map(parent => orders.load(parent))),
      Promise.all(parents.map(parent => profiles.load(parent))),
    ]);

    expect(orderRows).toEqual([
      [{ id: 10, userId: 1, total: 100 }],
      [{ id: 20, userId: 2, total: 200 }],
      [{ id: 30, userId: 3, total: 300 }],
    ]);
    expect(profileRows).toEqual([
      { id: 100, userId: 1, bio: 'profile-1' },
      null,
      { id: 300, userId: 3, bio: 'profile-3' },
    ]);
    expect(driver.calls).toHaveLength(2);
    const orderQuery = driver.calls.find(query => query.text.includes('"orders"'));
    const profileQuery = driver.calls.find(query => query.text.includes('"profiles"'));
    expect(orderQuery?.parameters).toEqual([1, 2, 3]);
    expect(profileQuery?.parameters).toEqual([1, 2, 3]);
  });

  it('keeps relation results scope-local and returns fresh child rows', async () => {
    const driver = recordingDriver(query =>
      query.parameters.map(userId => ({ id: Number(userId) * 10, userId, total: Number(userId) * 100 })),
    );
    const repository = new Users(driver);
    const firstScope = createLoaderScope();
    const firstLoader = firstScope.relationLoader(repository, 'orders');
    const parent = { id: 4, email: 'four@example.com' };

    const first = await firstLoader.load(parent);
    const cached = await firstScope.relationLoader(repository, 'orders').load(parent);
    const isolated = await createLoaderScope().relationLoader(repository, 'orders').load(parent);

    expect(first).toEqual(cached);
    expect(first).not.toBe(cached);
    expect(first[0]).not.toBe(cached[0]);
    expect(isolated).toEqual(first);
    expect(driver.calls).toHaveLength(2);
  });
});
