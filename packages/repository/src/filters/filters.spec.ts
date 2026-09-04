import { DatabaseSync } from 'node:sqlite';

import type { CompiledQuery } from '@zmdb/query-compiler';
import { BaseRepository, type Driver } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import type { ColumnIR, SchemaIR } from '@zmdb/schema-core/ir';
import { schemaFromIR } from '@zmdb/schema-core/ir';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

// Tests freeze for #449. The production filter types do not exist yet, so this file
// declares only the frozen value shape from repository/SPEC.md §3c and hands those
// values to the real BaseRepository. No repository method is stubbed.
interface FrozenPredicate {
  readonly col: string;
  readonly op: string;
  readonly value: unknown;
  readonly connector?: 'AND' | 'OR';
}

interface FilterDef<P = void> {
  readonly name: string;
  readonly where: (params: P) => readonly FrozenPredicate[];
  readonly enabled?: boolean;
  readonly appliesToWrites?: boolean;
}

export interface FilterUser extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  tenantId: number & Sql<'integer'>;
  role: string & Sql<'text'>;
  active: boolean & Sql<'boolean'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
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
  columns: [
    column('id', 'integer', { primaryKey: true, serial: true }),
    column('tenantId', 'integer'),
    column('role', 'text'),
    column('active', 'boolean'),
    column('deletedAt', 'timestamp', { nullable: true }),
  ],
  primaryKey: ['id'],
  relations: [],
};

const UserSchema = schemaFromIR(USER_IR);

const activeFilter = {
  name: 'active',
  where: (_params: void) => [{ col: 'active', op: '=', value: true }] as const,
} as const satisfies FilterDef;

const tenantFilter = {
  name: 'tenant',
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }] as const,
} as const satisfies FilterDef<{ readonly tenantId: number }>;

class ActiveUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [activeFilter] as const;
}

class TenantUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [tenantFilter] as const;
}

class TenantAndActiveUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [tenantFilter, activeFilter] as const;
}

class PlainUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
}

interface RecordingDriver extends Driver {
  readonly calls: CompiledQuery[];
}

function recordingDriver(rows: readonly Record<string, unknown>[] = []): RecordingDriver {
  const calls: CompiledQuery[] = [];
  return {
    calls,
    execute: query => {
      calls.push(query);
      return Promise.resolve(rows);
    },
  };
}

function statements(calls: readonly CompiledQuery[]): readonly { text: string; parameters: readonly unknown[] }[] {
  return calls.map(({ text, parameters }) => ({ text, parameters }));
}

describe('declared repository filters', () => {
  // Actual at 9e6b9757: all five statements below omit `"active" = $n`.
  // `count` and `exists` are also absent from BaseRepository, so the final two
  // assertions preserve that unresolved surface without inventing signatures.
  it.fails('applies a declared filter to every single-table read', async () => {
    const driver = recordingDriver();
    const repo = new ActiveUsers(driver);

    await repo.findById(7);
    await repo.findOne({ role: 'admin' });
    await repo.find({ role: 'admin' });
    await repo.findAll();
    await repo.list({ page: { limit: 2, offset: 0 } });

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "id" = $1 AND "active" = $2 LIMIT 1',
        parameters: [7, true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2 LIMIT 1',
        parameters: ['admin', true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2',
        parameters: ['admin', true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "active" = $1',
        parameters: [true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "active" = $1 ORDER BY "id" ASC LIMIT 3 OFFSET 0',
        parameters: [true],
      },
    ]);

    expect(Reflect.get(repo, 'count'), 'repository/SPEC.md names count, but no callable signature exists').toBeTypeOf(
      'function',
    );
    expect(Reflect.get(repo, 'exists'), 'repository/SPEC.md names exists, but no callable signature exists').toBeTypeOf(
      'function',
    );
  });

  // Actual at 9e6b9757:
  // SELECT "role", COUNT("id") AS "n" FROM "users" GROUP BY "role"
  it.fails('applies a filter to an aggregation and a group-by', async () => {
    const driver = recordingDriver();
    const repo = new ActiveUsers(driver);

    await repo.aggregate(aggregate => aggregate.select(['role']).count('id', 'n').groupBy('role'));

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT "role", COUNT("id") AS "n" FROM "users" WHERE "active" = $1 GROUP BY "role"',
        parameters: [true],
      },
    ]);
  });

  // The keyed write surface exists today, so its complete SQL can be frozen even
  // though the live issue names only the not-yet-declared bulk variants.
  // Actual at 9e6b9757: both statements end after their primary-key predicate.
  it.fails('applies a write filter to update and delete', async () => {
    const driver = recordingDriver();
    const repo = new ActiveUsers(driver);

    await repo.update(7, { role: 'user' });
    await repo.delete(7);

    expect(statements(driver.calls)).toEqual([
      {
        text: 'UPDATE "users" SET "role" = $1 WHERE "id" = $2 AND "active" = $3 RETURNING *',
        parameters: ['user', 7, true],
      },
      {
        text: 'DELETE FROM "users" WHERE "id" = $1 AND "active" = $2 RETURNING "id"',
        parameters: [7, true],
      },
    ]);
  });

  // Actual at 9e6b9757: both properties are undefined. Neither the frozen SPEC nor
  // #451 supplies a callable signature, so this title intentionally freezes only
  // their required existence; full SQL remains an explicit blocker in DOD.md.
  it.fails('applies a write filter to updateMany and deleteMany', () => {
    const repo = new ActiveUsers(recordingDriver());
    expect(Reflect.get(repo, 'updateMany')).toBeTypeOf('function');
    expect(Reflect.get(repo, 'deleteMany')).toBeTypeOf('function');
  });

  // Actual at 9e6b9757: findAll resolves and executes SELECT * FROM "users".
  it.fails('throws when a parameterised filter is called without its parameter, naming the filter', async () => {
    const driver = recordingDriver();
    const repo = new TenantUsers(driver);

    await expect(repo.findAll()).rejects.toThrow(
      'filter `tenant` requires parameters (tenantId) and none were supplied; pass them per call — ' +
        'findAll({ filters: { tenant: { tenantId } } }) — or disable it by name',
    );
    expect(driver.calls).toEqual([]);
  });

  // The cast widens only findAll's existing options object with the exact form
  // frozen in repository/SPEC.md §3c. The call still reaches the real method.
  // Actual at 9e6b9757: SELECT * FROM "users", parameters [].
  it.fails('disables one named filter for one call and leaves the others applied', async () => {
    const driver = recordingDriver();
    const repo = new TenantAndActiveUsers(driver);
    const findAll = repo.findAll.bind(repo) as (options: {
      readonly filters: {
        readonly tenant: { readonly tenantId: number };
        readonly active: false;
      };
    }) => ReturnType<TenantAndActiveUsers['findAll']>;

    await findAll({ filters: { tenant: { tenantId: 42 }, active: false } });

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "tenantId" = $1',
        parameters: [42],
      },
    ]);
  });

  it('leaves a repository with no declared filters byte-for-byte unchanged', async () => {
    const driver = recordingDriver();
    const repo = new PlainUsers(driver);

    await repo.find({ role: 'admin' });
    await repo.list({ page: { limit: 2, offset: 0 } });

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "role" = $1',
        parameters: ['admin'],
      },
      {
        text: 'SELECT * FROM "users" ORDER BY "id" ASC LIMIT 3 OFFSET 0',
        parameters: [],
      },
    ]);
  });
});

type SoftDeleteSchemaIR = SchemaIR & {
  readonly softDelete: { readonly column: 'deletedAt' };
};

const SOFT_DELETE_IR: SoftDeleteSchemaIR = {
  ...USER_IR,
  softDelete: { column: 'deletedAt' },
};

const SoftDeleteUserSchema = schemaFromIR(SOFT_DELETE_IR);

class SoftDeleteUsers extends BaseRepository<FilterUser> {
  static override readonly schema = SoftDeleteUserSchema;
}

function recordedSqlite(db: DatabaseSync): { readonly driver: Driver; readonly calls: CompiledQuery[] } {
  const inner = sqliteDriver(db);
  const calls: CompiledQuery[] = [];
  return {
    calls,
    driver: {
      dialect: 'sqlite',
      execute: query => {
        calls.push(query);
        return inner.execute(query);
      },
    },
  };
}

function openSoftDeleteDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE users (' +
      'id INTEGER PRIMARY KEY, tenantId INTEGER NOT NULL, role TEXT NOT NULL, ' +
      'active INTEGER NOT NULL, deletedAt TEXT)',
  );
  return db;
}

describe('soft delete against real SQLite', () => {
  // Actual at 9e6b9757:
  //   DELETE FROM "users" WHERE "id" = ? RETURNING "id"
  //   SELECT * FROM "users" WHERE "id" = ? LIMIT 1
  // and the physical row is gone.
  it.fails('soft-deletes by updating rather than deleting, and hides the row from subsequent reads', async () => {
    const db = openSoftDeleteDatabase();
    try {
      db.exec("INSERT INTO users VALUES (1, 7, 'user', 1, NULL)");
      const { driver, calls } = recordedSqlite(db);
      const repo = new SoftDeleteUsers(driver, 'sqlite');

      expect(await repo.delete(1)).toBe(true);
      const hidden = await repo.findById(1);

      expect(calls.map(query => query.text)).toEqual([
        'UPDATE "users" SET "deletedAt" = ? WHERE "id" = ? AND "deletedAt" IS NULL RETURNING "id"',
        'SELECT * FROM "users" WHERE "id" = ? AND "deletedAt" IS NULL LIMIT 1',
      ]);
      expect(calls[0]?.parameters[0]).toBeInstanceOf(Date);
      expect(calls[0]?.parameters.slice(1)).toEqual([1]);
      expect(calls[1]?.parameters).toEqual([1]);
      expect(db.prepare('SELECT deletedAt FROM users WHERE id = 1').get()).toEqual({
        deletedAt: expect.stringMatching(/^20\d\d-\d\d-\d\dT/),
      });
      expect(hidden).toBeUndefined();
    } finally {
      db.close();
    }
  });

  // Actual at 9e6b9757: both calls emit the same unfiltered SELECT and both
  // return the deleted row.
  it.fails('reads soft-deleted rows only when the filter is explicitly disabled', async () => {
    const db = openSoftDeleteDatabase();
    try {
      db.exec("INSERT INTO users VALUES (1, 7, 'user', 1, '2026-09-01T00:00:00.000Z')");
      const { driver, calls } = recordedSqlite(db);
      const repo = new SoftDeleteUsers(driver, 'sqlite');
      const findById = repo.findById.bind(repo) as (
        id: number,
        options: { readonly filters: { readonly softDelete: false } },
      ) => ReturnType<SoftDeleteUsers['findById']>;

      const hidden = await repo.findById(1);
      const visible = await findById(1, { filters: { softDelete: false } });

      expect(statements(calls)).toEqual([
        {
          text: 'SELECT * FROM "users" WHERE "id" = ? AND "deletedAt" IS NULL LIMIT 1',
          parameters: [1],
        },
        {
          text: 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1',
          parameters: [1],
        },
      ]);
      expect(hidden).toBeUndefined();
      expect(visible).toMatchObject({ id: 1, tenantId: 7, role: 'user', active: 1 });
      expect(visible?.deletedAt).toBeInstanceOf(Date);
    } finally {
      db.close();
    }
  });

  // The first three rows are deleted and the next twelve are live. Filtering in
  // SQL returns ten live rows; LIMIT-before-post-filtering can return only seven.
  // Actual at 9e6b9757: no WHERE, items 1..10.
  it.fails('applies a filter before LIMIT rather than post-filtering rows', async () => {
    const db = openSoftDeleteDatabase();
    try {
      const insert = db.prepare('INSERT INTO users VALUES (?, 7, ?, 1, ?)');
      for (let id = 1; id <= 15; id++) {
        insert.run(id, `user-${id}`, id <= 3 ? '2026-09-01T00:00:00.000Z' : null);
      }
      const { driver, calls } = recordedSqlite(db);
      const repo = new SoftDeleteUsers(driver, 'sqlite');

      const result = await repo.list({ page: { limit: 10, offset: 0 } });

      expect(statements(calls)).toEqual([
        {
          text: 'SELECT * FROM "users" WHERE "deletedAt" IS NULL ORDER BY "id" ASC LIMIT 11 OFFSET 0',
          parameters: [],
        },
      ]);
      expect(result.items.map(row => row.id)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      expect(result.hasMore).toBe(true);
    } finally {
      db.close();
    }
  });
});
