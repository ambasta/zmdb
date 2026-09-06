import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';

import { validate } from '@zmdb/aot-validator/utilities';
import { mssql } from '@zmdb/mssql';
import { createQueryCompiler, UnsupportedFeatureError, type CompiledQuery, type Dialect } from '@zmdb/query-compiler';
import { BaseRepository, ValidationError, type Driver } from '@zmdb/repository';
import { jsonSchemaFromIR, objectTypeFromIR, schemaFromIR, type SchemaIR, type TypeIR } from '@zmdb/schema-core/ir';
import { compilePopulate } from '@zmdb/schema-core/relations';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  withPackedBuildLock,
} from '../../../fixtures/client-adapters/src/packed-project.js';

const ROOT = process.cwd();
const PACKED_VERIFIER = join(ROOT, 'fixtures', 'consumer-runtime-foundation', 'verify-installed.mjs');
const TARGET_PACKAGE_ROOTS = [
  '@zmdb/schema',
  '@zmdb/sql',
  '@zmdb/validator',
  '@zmdb/orm',
  '@zmdb/ai',
  '@zmdb/postgres',
  '@zmdb/sqlite',
  '@zmdb/mssql',
] as const;
const OLD_PACKAGE_ROOTS = [
  '@zmdb/schema-core',
  '@zmdb/query-compiler',
  '@zmdb/aot-validator',
  '@zmdb/repository',
] as const;

const USERS_IR: SchemaIR = {
  table: 'users',
  physicalTable: 'app_users',
  columns: [
    {
      name: 'id',
      physicalName: 'user_id',
      sql: 'integer',
      nullable: false,
      primaryKey: true,
      serial: true,
      unique: true,
      hasDefault: true,
      sensitive: false,
      constraints: {},
      rules: [],
    },
    {
      name: 'email',
      physicalName: 'email_address',
      sql: 'varchar',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: true,
      hasDefault: false,
      sensitive: false,
      length: 255,
      constraints: { minLength: 3, maxLength: 255 },
      rules: [],
    },
    {
      name: 'createdAt',
      physicalName: 'created_at',
      sql: 'timestamp',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: true,
      sensitive: false,
      constraints: {},
      rules: [],
    },
    {
      name: 'passwordHash',
      physicalName: 'password_hash',
      sql: 'varchar',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: true,
      constraints: { minLength: 8 },
      rules: [],
    },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

const VALIDATOR_WITNESS: TypeIR = {
  kind: 'object',
  properties: [
    {
      name: 'email',
      type: { kind: 'scalar', scalar: 'string', constraints: { minLength: 3 } },
      optional: false,
      readonly: false,
    },
    {
      name: 'age',
      type: { kind: 'scalar', scalar: 'integer', constraints: { minimum: 18 } },
      optional: false,
      readonly: false,
    },
  ],
};

interface RuntimeUser extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'>;
}

const ORM_IR: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [
    {
      name: 'id',
      physicalName: 'id',
      sql: 'integer',
      nullable: false,
      primaryKey: true,
      serial: true,
      unique: true,
      hasDefault: true,
      sensitive: false,
      constraints: {},
      rules: [],
    },
    {
      name: 'email',
      physicalName: 'email',
      sql: 'varchar',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: true,
      hasDefault: false,
      sensitive: false,
      constraints: { minLength: 3 },
      rules: [],
    },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

let packedResult: SpawnSyncReturns<string>;

beforeAll(() => {
  packedResult = withPackedBuildLock(ROOT, () =>
    spawnSync(process.execPath, [PACKED_VERIFIER], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 300_000,
    }),
  );
}, PACKED_BUILD_TEST_TIMEOUT_MS);

function packedOutput(): string {
  return [packedResult.stdout, packedResult.stderr].filter(Boolean).join('\n');
}

describe('runtime foundation package cutover (#636)', () => {
  it.fails.each(TARGET_PACKAGE_ROOTS)('imports the final public root %s', packageName => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import('${packageName}')`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it.fails('installs @zmdb/schema alone and derives/types/serializes schema documents without SQL', () => {
    expect(packedResult.status, packedOutput()).toBe(0);
    expect(packedResult.stdout).toContain('schema: @zmdb/schema packed runtime and declarations OK');
  });

  it.fails('installs @zmdb/sql alone and compiles representative statements for every supported dialect', () => {
    expect(packedResult.status, packedOutput()).toBe(0);
    expect(packedResult.stdout).toContain('sql: @zmdb/sql packed runtime and declarations OK');
  });

  it.fails('installs @zmdb/validator with only @zmdb/schema and executes emitted validation and serialization helpers', () => {
    expect(packedResult.status, packedOutput()).toBe(0);
    expect(packedResult.stdout).toContain(
      'validator: @zmdb/schema, @zmdb/validator packed runtime and declarations OK',
    );
  });

  it.fails('installs @zmdb/orm with the three foundation dependencies and performs typed SQLite CRUD', () => {
    expect(packedResult.status, packedOutput()).toBe(0);
    expect(packedResult.stdout).toContain(
      'orm: @zmdb/orm, @zmdb/schema, @zmdb/sql, @zmdb/validator packed runtime and declarations OK',
    );
  });

  it.fails('cannot resolve any old package name or old public import after cutover', () => {
    for (const packageName of OLD_PACKAGE_ROOTS) {
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', `process.stdout.write(import.meta.resolve('${packageName}'))`],
        { cwd: ROOT, encoding: 'utf8' },
      );
      expect(result.status, `${packageName}\n${result.stderr}`).not.toBe(0);
    }
  });

  it('pins schema projection, document framing and serializable IR before the move', () => {
    const schema = schemaFromIR(USERS_IR);
    expect(schema.table).toBe('app_users');
    expect(schema.primaryKey).toEqual(['user_id']);
    expect(Object.keys(schema.columns)).toEqual(['user_id', 'email_address', 'created_at', 'password_hash']);
    expect(jsonSchemaFromIR(USERS_IR, 'create')).toEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        email: { type: 'string', maxLength: 255, minLength: 3 },
      },
      required: ['email'],
    });
    expect(JSON.parse(JSON.stringify(USERS_IR))).toEqual(USERS_IR);
  });

  it('pins SQL text and parameters for every currently supported dialect before the move', () => {
    const expected: Readonly<Record<Dialect, string>> = {
      postgres: 'SELECT "id", "email" FROM "users" WHERE "email" = $1 ORDER BY "id" ASC LIMIT 2',
      mysql: 'SELECT `id`, `email` FROM `users` WHERE `email` = ? ORDER BY `id` ASC LIMIT 2',
      sqlite: 'SELECT "id", "email" FROM "users" WHERE "email" = ? ORDER BY "id" ASC LIMIT 2',
      mssql:
        'SELECT [id], [email] FROM [users] WHERE [email] = @p1 ORDER BY [id] ASC OFFSET 0 ROWS FETCH NEXT 2 ROWS ONLY',
      cockroach: 'SELECT "id", "email" FROM "users" WHERE "email" = $1 ORDER BY "id" ASC LIMIT 2',
      singlestore: 'SELECT `id`, `email` FROM `users` WHERE `email` = ? ORDER BY `id` ASC LIMIT 2',
    };

    for (const dialect of Object.keys(expected) as Dialect[]) {
      const target = dialect === 'mssql' ? mssql : dialect;
      expect(
        createQueryCompiler(target)
          .selectFrom('users')
          .select(['id', 'email'])
          .where('email', '=', 'a@example.test')
          .orderBy('id', 'asc')
          .limit(2)
          .compile(),
      ).toEqual({
        text: expected[dialect],
        parameters: ['a@example.test'],
      });
    }
  });

  it('refuses SQL Server row-value IN instead of emitting invalid SQL', () => {
    const id = USERS_IR.columns.find(column => column.name === 'id');
    if (id === undefined) throw new Error('runtime-foundation fixture has no id column');
    const compositeUsers: SchemaIR = {
      table: 'users',
      physicalTable: 'users',
      columns: [
        {
          ...id,
          name: 'tenantId',
          physicalName: 'tenantId',
          sql: 'text',
          serial: false,
          unique: false,
          hasDefault: false,
        },
        { ...id, name: 'id', physicalName: 'id', serial: false, unique: false, hasDefault: false },
      ],
      primaryKey: ['tenantId', 'id'],
      relations: [{ name: 'posts', relation: 'oneToMany', target: 'posts', via: 'tenantId,userId' }],
      foreignKeys: [],
    };

    let caught: unknown;
    try {
      compilePopulate(compositeUsers, 'posts', mssql, [['tenant-1', 1]]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedFeatureError);
    if (!(caught instanceof UnsupportedFeatureError)) throw new Error('expected UnsupportedFeatureError');
    expect(caught.feature).toBe('composite-key populate for relation "posts"');
    expect(caught.dialect).toBe('mssql');
    expect(caught.message).toMatch(/dialect "mssql" does not support row-value IN/);
  });

  it('pins validator acceptance, issue order and exactness before the move', () => {
    expect(validate({ email: 'abc', age: 18 }, VALIDATOR_WITNESS)).toEqual({
      success: true,
      data: { email: 'abc', age: 18 },
    });
    expect(validate({ email: 'x', age: 17 }, VALIDATOR_WITNESS)).toEqual({
      success: false,
      errors: [
        {
          path: 'input.email',
          expected: 'minLength 3',
          value: 'x',
          message: 'expected minLength 3',
        },
        {
          path: 'input.age',
          expected: 'minimum 18',
          value: 17,
          message: 'expected minimum 18',
        },
      ],
    });
    expect(objectTypeFromIR(USERS_IR, 'create').properties.map(property => property.name)).toEqual([
      'email',
      'createdAt',
      'passwordHash',
    ]);
  });

  it('pins ORM validation and structural-driver SQL before the move', async () => {
    const queries: CompiledQuery[] = [];
    const driver: Driver = {
      dialect: 'sqlite',
      execute(query) {
        queries.push(query);
        return Promise.resolve(
          query.text.startsWith('INSERT')
            ? [{ id: 1, email: query.parameters[0] }]
            : [{ id: 1, email: 'a@example.test' }],
        );
      },
    };
    const schema = schemaFromIR(ORM_IR);
    class Users extends BaseRepository<RuntimeUser> {
      static override readonly schema = schema;
    }

    const users = new Users(driver, 'sqlite');
    await expect(users.create({ email: 'a@example.test' })).resolves.toEqual({
      id: 1,
      email: 'a@example.test',
    });
    await expect(users.findById(1)).resolves.toEqual({ id: 1, email: 'a@example.test' });
    await expect(users.create({ email: 'x' })).rejects.toMatchObject({
      name: ValidationError.name,
      message: 'validation failed: input.email',
    });
    expect(queries).toEqual([
      {
        text: 'INSERT INTO "users" ("email") VALUES (?) RETURNING *',
        parameters: ['a@example.test'],
      },
      {
        text: 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1',
        parameters: [1],
      },
    ]);
  });
});
