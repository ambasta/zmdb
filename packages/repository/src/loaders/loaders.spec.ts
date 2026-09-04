import type { CompiledQuery } from '@zmdb/query-compiler';
import type { DeclaredTable, Entity, PrimaryKeyOf } from '@zmdb/schema-core';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { BaseRepository, type Driver } from '../index.js';

// Tests freeze for #466, against repository/SPEC.md §3d.
//
// `createLoaderScope` does not exist at d34bfbaf. This boundary reads the real
// package export by name and transcribes only the callable shape frozen in the
// spec. It supplies no batching implementation: every test currently fails with
// `TypeError: @zmdb/repository exports no "createLoaderScope"`.
interface EntityLoader<T extends DeclaredTable> {
  load(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
}

interface LoaderScope {
  loaderFor<T extends DeclaredTable>(repository: BaseRepository<T>): EntityLoader<T>;
}

const repositoryApi: object = await import('../index.js');

function createLoaderScope(): LoaderScope {
  const candidate: unknown = Reflect.get(repositoryApi, 'createLoaderScope');
  if (typeof candidate !== 'function') {
    throw new TypeError('@zmdb/repository exports no "createLoaderScope"');
  }
  return Reflect.apply(candidate, undefined, []) as LoaderScope;
}

export interface LoaderUser extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'>;
}

function column(name: string, sql: ColumnIR['sql'], overrides: Partial<ColumnIR> = {}): ColumnIR {
  return {
    name,
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
  columns: [column('id', 'integer', { primaryKey: true }), column('email', 'text')],
  primaryKey: ['id'],
  relations: [],
};

const UserSchema = schemaFromIR(USER_IR);

class Users extends BaseRepository<LoaderUser> {
  static override readonly schema = UserSchema;
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

describe('request-scoped dataloaders (frozen: repository/SPEC.md 3d)', () => {
  // Actual at d34bfbaf: @zmdb/repository exports no createLoaderScope.
  // The recording driver is the oracle: 100 synchronous loads must produce one
  // dispatch with one IN statement, independent of machine or event-loop timing.
  it.fails('coalesces findById calls in one tick into a single IN query', async () => {
    const driver = recordingDriver(rowsForIds);
    const loader = createLoaderScope().loaderFor(new Users(driver));
    const ids = Array.from({ length: 100 }, (_, index) => index + 1);

    const rows = await Promise.all(ids.map(id => loader.load(id)));

    expect(rows.map(row => row?.id)).toEqual(ids);
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]?.text).toContain(' IN (');
    expect(driver.calls[0]?.parameters).toEqual(ids);
  });

  // Actual at d34bfbaf: @zmdb/repository exports no createLoaderScope.
  // The accepted #465 spec corrected the generated issue: duplicate callers get
  // structurally equal fresh shallow copies, not one shared entity reference.
  it.fails('fetches a duplicated id once and resolves both callers', async () => {
    const driver = recordingDriver(rowsForIds);
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const [first, second] = await Promise.all([loader.load(7), loader.load(7)]);

    expect(first).toEqual({ id: 7, email: 'user-7@example.com' });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]?.parameters).toEqual([7]);
  });

  // Actual at d34bfbaf: @zmdb/repository exports no createLoaderScope.
  it.fails('resolves undefined for an id the batch did not return', async () => {
    const driver = recordingDriver(query => rowsForIds(query).filter(row => row.id !== 2));
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const rows = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);

    expect(rows).toEqual([{ id: 1, email: 'user-1@example.com' }, undefined, { id: 3, email: 'user-3@example.com' }]);
    expect(driver.calls).toHaveLength(1);
  });

  // Actual at d34bfbaf: @zmdb/repository exports no createLoaderScope.
  it.fails('rejects every call in a batch when the driver errors', async () => {
    const failure = new Error('database unavailable');
    const driver = recordingDriver(() => Promise.reject(failure));
    const loader = createLoaderScope().loaderFor(new Users(driver));

    const settled = await Promise.allSettled([loader.load(1), loader.load(2), loader.load(3)]);

    expect(settled).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(driver.calls).toHaveLength(1);
  });

  // Actual at d34bfbaf: @zmdb/repository exports no createLoaderScope.
  // Two explicit scope objects are the security boundary. Sharing the repository
  // is deliberate: only the scopes differ, so two calls prove no row leaked.
  it.fails('does not share loaded rows between two scopes', async () => {
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

  // Actual at d34bfbaf: @zmdb/repository exports no createLoaderScope.
  // Awaiting an already-resolved promise yields to the microtask queue. The first
  // scheduled flush must therefore run before the second load; no timer is used.
  it.fails('does not batch across ticks', async () => {
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
});
