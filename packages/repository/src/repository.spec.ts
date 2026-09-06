import { schemasFrom } from '@zmdb/compiler/testing';
import type { CompiledQuery } from '@zmdb/query-compiler';
import type { CreateDTO, ValidationIssue } from '@zmdb/schema-core';
import type { Length, Max, Min, Pattern, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, vi } from 'vitest';

import { usePostgres } from '../../postgres/src/testing/fixture.js';
import { BaseRepository, ValidationError, type Driver } from './index.js';
import { officialDialects, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';

// #25: repository CRUD + validation interception.

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: 'admin' | 'user';
}

/** The constraint-carrying schema the write-validation block below drives. */
export interface Account extends Table<'accounts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<32> & Pattern<'^\\S+@\\S+$'>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  createdAt: Date & Sql<'timestamp'>;
  // `object`, not `unknown`: a JSON column holds an object or an array and rejects
  // primitives, which is what `object` means, and `unknown & Sql<'json'>` would collapse
  // to the tag alone. The emitted check is `expected object | array` — see below.
  settings: object & Sql<'json'>;
}

/** A text primary key, for the "a patch body may not carry the key" test. */
export interface Tenant extends Table<'tenants'> {
  slug: string & Sql<'text'> & PrimaryKey;
  name: string & Sql<'text'>;
}

const {
  User: UserSchema,
  Account: AccountSchema,
  Tenant: TenantSchema,
} = schemasFrom<{ User: User; Account: Account; Tenant: Tenant }>(import.meta.url, ['User', 'Account', 'Tenant']);

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

function fakeDriver(rows: Record<string, unknown>[] = []): Driver & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    dialect: postgresDialect,
    calls,
    execute: vi.fn(async q => {
      calls.push(q);
      return rows;
    }),
  };
}

function telemetryDriver(enabled: boolean): Driver & { calls: CompiledQuery[] } {
  const calls: CompiledQuery[] = [];
  const execute = (query: CompiledQuery) => {
    calls.push(query);
    return Promise.resolve([{ id: 1, email: 'a@b.com', role: 'user' }]);
  };
  return enabled
    ? { dialect: postgresDialect, calls, queryTelemetry: true, execute }
    : { dialect: postgresDialect, calls, execute };
}

async function exerciseEveryRepositoryQueryBuilder(repo: UserRepository): Promise<void> {
  await repo.findById(1);
  await repo.create({ email: 'a@b.com', role: 'user' });
  await repo.update(1, { role: 'admin' });
  await repo.delete(1);
  await repo.findJoined({
    target: 'orders',
    leftCol: 'users.id',
    rightCol: 'orders.user_id',
  });
  await repo.aggregate(aggregate => aggregate.count('id', 'count'));
  await repo.findByFullText('email', 'a@b.com');
}

describe('BaseRepository read methods', () => {
  it('findById compiles a SELECT and maps the row', async () => {
    const driver = fakeDriver([{ id: 1, email: 'a@b.com', role: 'user' }]);
    const repo = new UserRepository(driver);
    const user = await repo.findById(1);
    expect(user).toEqual({ id: 1, email: 'a@b.com', role: 'user' });
    expect(driver.calls.length).toBe(1);
  });

  it('findAll returns plain objects (no proxy)', async () => {
    const driver = fakeDriver([{ id: 1, email: 'a@b.com', role: 'user' }]);
    const repo = new UserRepository(driver);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(Object.getPrototypeOf(all[0])).toBe(Object.prototype);
  });

  it('keeps every repository query path two-keyed unless the driver opts in', async () => {
    const driver = telemetryDriver(false);
    await exerciseEveryRepositoryQueryBuilder(new UserRepository(driver));

    expect(driver.calls).toHaveLength(7);
    for (const query of driver.calls) {
      expect(Object.keys(query)).toEqual(['text', 'parameters', 'operation', 'isWrite', 'returnsRows']);
      expect(query.telemetry).toBeUndefined();
    }
  });

  it('passes driver telemetry through core CRUD, joins, aggregations and full-text search', async () => {
    const driver = telemetryDriver(true);
    await exerciseEveryRepositoryQueryBuilder(new UserRepository(driver));

    expect(driver.calls.map(query => query.telemetry)).toEqual([
      { system: 'postgresql', operation: 'SELECT', collection: 'users' },
      { system: 'postgresql', operation: 'INSERT', collection: 'users' },
      { system: 'postgresql', operation: 'UPDATE', collection: 'users' },
      { system: 'postgresql', operation: 'DELETE', collection: 'users' },
      { system: 'postgresql', operation: 'SELECT', collection: 'users' },
      { system: 'postgresql', operation: 'SELECT', collection: 'users' },
      { system: 'postgresql', operation: 'SELECT', collection: 'users' },
    ]);
  });

  it('preserves the telemetry marker when rebinding a repository to a transaction', async () => {
    const parent = telemetryDriver(true);
    const transactionQueries: CompiledQuery[] = [];
    const repo = new UserRepository(parent).withTransaction({
      execute: query => {
        transactionQueries.push(query);
        return Promise.resolve([]);
      },
    });

    await repo.findJoined({
      target: 'orders',
      leftCol: 'users.id',
      rightCol: 'orders.user_id',
    });

    expect(parent.calls).toEqual([]);
    expect(transactionQueries[0]?.telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'users',
    });
    expect(Object.keys(transactionQueries[0]?.telemetry ?? {})).toEqual(['system', 'operation', 'collection']);
  });
});

describe('BaseRepository create/update validation interception', () => {
  it('valid create executes an INSERT', async () => {
    const driver = fakeDriver([{ id: 1, email: 'a@b.com', role: 'user' }]);
    const repo = new UserRepository(driver);
    const created = await repo.create({ email: 'a@b.com', role: 'user' });
    expect(created).toEqual({ id: 1, email: 'a@b.com', role: 'user' });
  });

  it('invalid create throws ValidationError and executes NO SQL', async () => {
    const driver = fakeDriver();
    const repo = new UserRepository(driver);
    let error: ValidationError | undefined;
    try {
      // The cast is the point: untrusted input reaching a typed API at runtime.
      // `email` missing and `role` off-enum are both compile errors, because the schema
      // came from a type — the validator has to catch them anyway.
      await repo.create({ role: 'nope' } as unknown as CreateDTO<User>);
    } catch (e) {
      if (e instanceof ValidationError) error = e;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(driver.calls.length).toBe(0);
    // The issues come from the shared runtime walker now, not from a walk this package
    // owned, so they read the way every other zmdb validator's do — and say more: the
    // enum column reports the values it will accept, where `expected: 'jsonEnum'` named
    // the column type and left the caller to go and look them up.
    expect(error?.issues).toEqual([
      { path: 'input.email', message: 'expected string', expected: 'string', value: undefined },
      { path: 'input.role', message: 'expected "admin" | "user"', expected: '"admin" | "user"', value: 'nope' },
    ]);
  });
});

// What a write now checks, and did not before. The walk this package used to own knew
// nothing about a bound or a pattern — so a schema's `Min<18>` was enforced at the HTTP
// edge by a different validator and nowhere else, and a write that went straight to a
// repository skipped it — and it accepted `Date | string` for a `timestamp`, so neither
// of the column's two types was ever the one being checked.
describe('BaseRepository write validation, through the IR', () => {
  class AccountRepository extends BaseRepository<Account> {
    static override readonly schema = AccountSchema;
  }

  const valid = {
    email: 'a@b.co',
    age: 30,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    settings: { theme: 'dark' },
  };

  // The cast on every call is the same one the test above explains: these are compile
  // errors in `CreateDTO`, and the runtime check is what stands between the database and
  // input that never went through the compiler.
  async function rejects(patch: Record<string, unknown>): Promise<readonly ValidationIssue[]> {
    const driver = fakeDriver();
    const repo = new AccountRepository(driver);
    const payload = { ...valid, ...patch } as unknown as CreateDTO<Account>;
    try {
      await repo.create(payload);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      expect(driver.calls.length).toBe(0);
      return e.issues;
    }
    throw new Error('expected the payload to be rejected');
  }

  it('accepts the payload every column is happy with', async () => {
    const driver = fakeDriver([{ id: 1, ...valid }]);
    const repo = new AccountRepository(driver);
    await repo.create(valid as unknown as CreateDTO<Account>);
    expect(driver.calls.length).toBe(1);
  });

  it('enforces the bounds the schema declares', async () => {
    expect(await rejects({ age: 17 })).toEqual([
      { path: 'input.age', message: 'expected minimum 18', expected: 'minimum 18', value: 17 },
    ]);
    expect(await rejects({ age: 121 })).toEqual([
      { path: 'input.age', message: 'expected maximum 120', expected: 'maximum 120', value: 121 },
    ]);
  });

  it('enforces a pattern, and the length a varchar implies', async () => {
    expect(await rejects({ email: 'nope' })).toEqual([
      {
        path: 'input.email',
        message: 'expected pattern ^\\S+@\\S+$',
        expected: 'pattern ^\\S+@\\S+$',
        value: 'nope',
      },
    ]);
    const long = `${'a'.repeat(40)}@b.co`;
    expect(await rejects({ email: long })).toEqual([
      { path: 'input.email', message: 'expected maxLength 32', expected: 'maxLength 32', value: long },
    ]);
  });

  it('wants the app type of a timestamp, not the wire type', async () => {
    // An ISO string is what arrives in a request body, and it is wrong here: a caller at
    // this layer has decoded the body and holds a `Date`. The old check took either, which
    // is how `Entity<S>` saying `Date` and the document saying `string` went unnoticed.
    expect(await rejects({ createdAt: '2026-01-01T00:00:00.000Z' })).toEqual([
      { path: 'input.createdAt', message: 'expected Date', expected: 'Date', value: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('still says the one thing it knows about a json column', async () => {
    // `json()` erases its payload type, so the check is "not a primitive" — which is what
    // it has always been, and it survives the move to the shared walker.
    expect(await rejects({ settings: 123 })).toEqual([
      { path: 'input.settings', message: 'expected object | array', expected: 'object | array', value: 123 },
    ]);
    const driver = fakeDriver([{ id: 1 }]);
    await new AccountRepository(driver).create({
      ...valid,
      settings: [1, 2],
    } as unknown as CreateDTO<Account>);
    expect(driver.calls.length).toBe(1);
  });
});

// REQ-RP-3. Both of these were dropped in silence: `bogus` disappeared, and a supplied
// `id` on a serial key was ignored, so the insert went through with the database about to
// generate the value the caller thought they had chosen.
describe('BaseRepository rejects a key the write does not accept', () => {
  const valid = { email: 'a@b.com', role: 'user' as const };

  async function createRejects(patch: Record<string, unknown>): Promise<readonly ValidationIssue[]> {
    const driver = fakeDriver();
    const repo = new UserRepository(driver);
    try {
      await repo.create({ ...valid, ...patch } as unknown as CreateDTO<User>);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      expect(driver.calls.length).toBe(0);
      return e.issues;
    }
    throw new Error('expected the payload to be rejected');
  }

  it('names an unknown key rather than dropping it', async () => {
    expect(await createRejects({ bogus: 1 })).toEqual([
      {
        path: 'input.bogus',
        message: '"bogus" is not a column of "users"',
        expected: 'no excess properties',
        value: 1,
      },
    ]);
  });

  it('refuses a database-generated column on insert', async () => {
    expect(await createRejects({ id: 5 })).toEqual([
      {
        path: 'input.id',
        message: 'the database generates "id", so a payload cannot supply it',
        expected: 'no excess properties',
        value: 5,
      },
    ]);
  });

  it('reports the misspelling next to the column it was meant to be', async () => {
    // Why this is reported alongside the structural issues instead of only when there are
    // none, which is the rule `assertEquals` follows. "`email` is missing" on its own
    // sends you looking at the wrong thing.
    expect(await createRejects({ email: undefined, emial: 'a@b.com' })).toEqual([
      { path: 'input.email', message: 'expected string', expected: 'string', value: undefined },
      {
        path: 'input.emial',
        message: '"emial" is not a column of "users"',
        expected: 'no excess properties',
        value: 'a@b.com',
      },
    ]);
  });

  it('refuses a key column in a patch, which identifies the row instead', async () => {
    // A patch body says what to change, and the URL says which row — so a key in the body
    // is either redundant or an attempt to move the row. Spelled out for a non-serial key,
    // because that is the one the create path would have allowed.
    class TenantRepository extends BaseRepository<Tenant> {
      static override readonly schema = TenantSchema;
    }
    const driver = fakeDriver();
    const repo = new TenantRepository(driver);
    let error: ValidationError | undefined;
    try {
      await repo.update('acme', { slug: 'acme-2' } as unknown as Parameters<typeof repo.update>[1]);
    } catch (e) {
      if (e instanceof ValidationError) error = e;
    }
    expect(driver.calls.length).toBe(0);
    expect(error?.issues).toEqual([
      {
        path: 'input.slug',
        message: '"slug" identifies the row and cannot be patched',
        expected: 'no excess properties',
        value: 'acme-2',
      },
    ]);
    // And it is accepted on insert, where it is the caller's to choose.
    const insert = fakeDriver([{ slug: 'acme', name: 'Acme' }]);
    await new TenantRepository(insert).create({ slug: 'acme', name: 'Acme' });
    expect(insert.calls.length).toBe(1);
  });

  it('leaves an explicitly undefined key alone, so a spread still works', async () => {
    // `{ ...patch, role: undefined }` is how optional fields get built, and it means "not
    // supplied" — which is not the same as supplying a key that does not exist.
    const driver = fakeDriver([{ id: 1, ...valid }]);
    const repo = new UserRepository(driver);
    await repo.create({ ...valid, bogus: undefined } as unknown as CreateDTO<User>);
    expect(driver.calls.length).toBe(1);
  });
});

describe('BaseRepository delete', () => {
  it('delete compiles a DELETE and reports success', async () => {
    const driver = fakeDriver([{ id: 1 }]);
    const repo = new UserRepository(driver);
    expect(await repo.delete(1)).toBe(true);
  });
});

// Stored-routine call contract frozen by #437 and implemented by #439. The
// reflection helpers keep exercising the public package boundary rather than a
// test-only compiler or repository stand-in.

type RoutineSqlType =
  | 'serial'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'text'
  | 'varchar'
  | 'boolean'
  | 'timestamp'
  | 'json'
  | 'jsonEnum';

interface FrozenRoutineDef {
  readonly kind: 'function' | 'procedure';
  readonly name: string;
  readonly params: readonly {
    readonly name: string;
    readonly type: RoutineSqlType;
    readonly mode?: 'in' | 'out' | 'inout';
  }[];
  readonly returns?: { readonly type: RoutineSqlType | 'void'; readonly setof?: boolean };
  readonly language?: string;
  readonly deterministic?: boolean;
  readonly body: string;
}

interface FrozenRoutineCompiler {
  callFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callTableFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callProcedure(name: string, args: readonly unknown[]): CompiledQuery;
}

const CALL_EXPORTS = ['callFunction', 'callTableFunction', 'callProcedure'] as const;

function isRoutineCompiler(loaded: object): loaded is FrozenRoutineCompiler {
  return CALL_EXPORTS.every(name => typeof Reflect.get(loaded, name) === 'function');
}

async function routineCompiler(dialect: 'postgres' | 'mysql' | 'sqlite' | 'cockroach'): Promise<FrozenRoutineCompiler> {
  const loaded: unknown = await import('@zmdb/query-compiler');
  if (typeof loaded !== 'object' || loaded === null) {
    throw new Error('@zmdb/query-compiler did not load as a module record');
  }
  const create: unknown = Reflect.get(loaded, 'createQueryCompiler');
  if (typeof create !== 'function') {
    throw new Error('@zmdb/query-compiler exports no createQueryCompiler');
  }
  const compiler: unknown = Reflect.apply(create, undefined, [officialDialects[dialect]]);
  if (typeof compiler !== 'object' || compiler === null || !isRoutineCompiler(compiler)) {
    throw new Error(`createQueryCompiler("${dialect}") exposes no ${CALL_EXPORTS.join(', ')}`);
  }
  return compiler;
}

type FrozenRepositoryCall = (def: FrozenRoutineDef, args: readonly unknown[]) => Promise<unknown>;

function isRepositoryCall(value: unknown): value is FrozenRepositoryCall {
  return typeof value === 'function';
}

async function callRoutine(
  repository: object,
  definition: FrozenRoutineDef,
  args: readonly unknown[],
): Promise<unknown> {
  const call: unknown = Reflect.get(repository, 'call');
  if (!isRepositoryCall(call)) {
    throw new Error('@zmdb/repository BaseRepository has no protected call(def, args)');
  }
  return Reflect.apply(call, repository, [definition, args]);
}

const archiveRoutine: FrozenRoutineDef = {
  kind: 'function',
  name: 'archive_old_orders',
  params: [{ name: 'cutoff', type: 'timestamp' }],
  returns: { type: 'integer' },
  language: 'plpgsql',
  body: 'BEGIN RETURN 1; END;',
};

describe('stored routine SQL calls (frozen: repository/SPEC.md 4a)', () => {
  it('the current driver preserves bound parameters without interpolation', async () => {
    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    const driver = fakeDriver();
    await driver.execute({ text: 'SELECT "archive_old_orders"($1) AS "result"', parameters: [cutoff] });
    expect(driver.calls).toEqual([{ text: 'SELECT "archive_old_orders"($1) AS "result"', parameters: [cutoff] }]);
  });

  it('compiles a function call to SELECT with bound arguments', async () => {
    const postgres = await routineCompiler('postgres');
    const mysql = await routineCompiler('mysql');
    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    expect(postgres.callFunction('archive_old_orders', [cutoff])).toEqual({
      text: 'SELECT "archive_old_orders"($1) AS "result"',
      parameters: [cutoff],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
    expect(mysql.callFunction('archive_old_orders', [cutoff])).toEqual({
      text: 'SELECT `archive_old_orders`(?) AS `result`',
      parameters: [cutoff],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
    expect(postgres.callFunction('odd"name', [cutoff])).toEqual({
      text: 'SELECT "odd""name"($1) AS "result"',
      parameters: [cutoff],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
  });

  it('compiles a procedure call to CALL with bound arguments', async () => {
    const postgres = await routineCompiler('postgres');
    const mysql = await routineCompiler('mysql');
    expect(postgres.callProcedure('rebuild_search_index', ['tenant-a', 25])).toEqual({
      text: 'CALL "rebuild_search_index"($1, $2)',
      parameters: ['tenant-a', 25],
      operation: 'other',
      isWrite: false,
      returnsRows: false,
    });
    expect(mysql.callProcedure('rebuild_search_index', ['tenant-a', 25])).toEqual({
      text: 'CALL `rebuild_search_index`(?, ?)',
      parameters: ['tenant-a', 25],
      operation: 'other',
      isWrite: false,
      returnsRows: false,
    });
  });

  it('compiles a set-returning function call as rows', async () => {
    const routines = await routineCompiler('postgres');
    expect(routines.callTableFunction('active_user_ids', [7n])).toEqual({
      text: 'SELECT * FROM "active_user_ids"($1)',
      parameters: [7n],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });

    const cockroach = await routineCompiler('cockroach');
    expect(cockroach.callTableFunction('active_user_ids', [7n])).toEqual({
      text: 'SELECT * FROM "active_user_ids"($1)',
      parameters: [7n],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
  });

  it('refuses routine calls on sqlite, naming the routine', async () => {
    const compiler = await routineCompiler('sqlite');
    expect(() => compiler.callFunction(archiveRoutine.name, [new Date()])).toThrow(
      /sqlite.*archive_old_orders|archive_old_orders.*sqlite/i,
    );

    const driver = fakeDriver();
    const repo = new UserRepository(driver, sqliteDialect);
    await expect(callRoutine(repo, archiveRoutine, [new Date()])).rejects.toThrow(
      /sqlite.*archive_old_orders|archive_old_orders.*sqlite/i,
    );
    expect(driver.calls).toEqual([]);
  });
});

describe('typed stored routine calls (frozen: repository/SPEC.md 4a)', () => {
  it('refuses a routine name that is not declared', async () => {
    const driver = fakeDriver();
    const repo = new UserRepository(driver);
    await expect(
      callRoutine(repo, 'archive_old_orders' as unknown as FrozenRoutineDef, [new Date()]),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(driver.calls).toEqual([]);
  });

  it('validates arguments against the declared parameter types before calling', async () => {
    const driver = fakeDriver([{ result: 1 }]);
    const repo = new UserRepository(driver);
    await expect(callRoutine(repo, archiveRoutine, ['2026-01-01T00:00:00.000Z'])).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(callRoutine(repo, archiveRoutine, [])).rejects.toBeInstanceOf(ValidationError);
    expect(driver.calls).toEqual([]);
  });

  it('validates a scalar result against the declared return type', async () => {
    const driver = fakeDriver([{ result: 'not an integer' }]);
    const repo = new UserRepository(driver);
    await expect(callRoutine(repo, archiveRoutine, [new Date()])).rejects.toBeInstanceOf(ValidationError);
    expect(driver.calls).toHaveLength(1);
  });

  it('types a set-returning function as rows', async () => {
    const driver = fakeDriver([{ active_user_ids: '7' }, { active_user_ids: '9' }]);
    const repo = new UserRepository(driver);
    const rows = await callRoutine(
      repo,
      {
        kind: 'function',
        name: 'active_user_ids',
        params: [{ name: 'org_id', type: 'bigint' }],
        returns: { type: 'bigint', setof: true },
        language: 'sql',
        body: 'SELECT id FROM users WHERE org_id = org_id;',
      },
      [3n],
    );
    expect(rows).toEqual([7n, 9n]);
  });

  it('returns nothing from a declared procedure', async () => {
    const driver = fakeDriver([{ ignored: true }]);
    const repo = new UserRepository(driver);
    await expect(
      callRoutine(
        repo,
        {
          kind: 'procedure',
          name: 'rebuild_search_index',
          params: [{ name: 'tenant_id', type: 'text' }],
          body: 'BEGIN END;',
        },
        ['tenant-a'],
      ),
    ).resolves.toBeUndefined();
    expect(driver.calls).toEqual([
      {
        text: 'CALL "rebuild_search_index"($1)',
        parameters: ['tenant-a'],
        operation: 'other',
        isWrite: false,
        returnsRows: false,
      },
    ]);
  });

  it('routes routine calls through a transaction-bound repository', async () => {
    const parent = fakeDriver();
    const transactionCalls: CompiledQuery[] = [];
    const repo = new UserRepository(parent).withTransaction({
      execute: query => {
        transactionCalls.push(query);
        return Promise.resolve([{ result: 1 }]);
      },
    });

    await expect(callRoutine(repo, archiveRoutine, [new Date('2026-01-01T00:00:00.000Z')])).resolves.toBe(1);
    expect(parent.calls).toEqual([]);
    expect(transactionCalls).toEqual([
      {
        text: 'SELECT "archive_old_orders"($1) AS "result"',
        parameters: [new Date('2026-01-01T00:00:00.000Z')],
        operation: 'select',
        isWrite: false,
        returnsRows: true,
      },
    ]);
  });
});

const routinePg = usePostgres(async pool => {
  await pool.query('DROP FUNCTION IF EXISTS zmdb_test_add_one(INTEGER)');
  await pool.query(
    "CREATE FUNCTION zmdb_test_add_one(value INTEGER) RETURNS INTEGER LANGUAGE sql AS 'SELECT value + 1'",
  );
});

describe('stored routine integration (real Postgres, loudly gated)', () => {
  it('the real-Postgres gate proves the function through a raw bound call', async () => {
    if (!routinePg.reachable()) {
      console.warn('[skip] calls a real function: Postgres not reachable');
      return;
    }
    const result = await routinePg.pool().query('SELECT zmdb_test_add_one($1) AS result', [41]);
    expect(result.rows).toEqual([{ result: 42 }]);
  });

  it('calls a real function', async () => {
    if (!routinePg.reachable()) {
      console.warn('[skip] calls a real function: Postgres not reachable');
      return;
    }
    try {
      const raw = await routinePg.pool().query('SELECT zmdb_test_add_one($1) AS result', [41]);
      expect(raw.rows).toEqual([{ result: 42 }]);

      const repo = new UserRepository(routinePg.driver());
      await expect(
        callRoutine(
          repo,
          {
            kind: 'function',
            name: 'zmdb_test_add_one',
            params: [{ name: 'value', type: 'integer' }],
            returns: { type: 'integer' },
            language: 'sql',
            body: 'SELECT value + 1',
          },
          [41],
        ),
      ).resolves.toBe(42);
    } finally {
      await routinePg.pool().query('DROP FUNCTION IF EXISTS zmdb_test_add_one(INTEGER)');
    }
  });
});
