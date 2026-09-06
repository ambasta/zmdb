// One deliberately awkward table, declared as a type, all the way to the DDL.
//
// This file used to be a differential. `defineSchema` still existed, so the claim was that
// `schemaFromIR(irFromSchema(authored))` compiled byte-identical DDL and byte-identical CRUD to
// `authored` itself — which reused the whole existing SQL suite as the argument that a tagged
// declaration reaches the database as the same table. That argument is spent: the value front
// end is gone, every fixture in the SQL suite is a tagged interface now, so the suite covers the
// tagged path directly rather than by inheritance.
//
// The corpus is worth keeping on its own, and so is asking it a question a differential cannot
// ask. Between these three tables: every `SqlType`, a composite primary key, a non-serial
// primary key, foreign keys, nullable and defaulted columns, a sensitive column, a json column
// with a payload shape, and an FTS table. Two of those are still dropped on the way to the
// DDL; the composite key is preserved as one ordered table constraint. The old version could
// not have noticed any of it, because both sides of the comparison were wrong in the same way.

import { schemasFrom } from '@zmdb/compiler/testing';
import { diff, emitUp, snapshot, type SchemaSnapshot } from '@zmdb/migrations';
import type { CompiledQuery, Dialect, DialectTarget } from '@zmdb/query-compiler';
import type { CoreSchema, CreateDTO, PrimaryKeyOf, TaggedSchema } from '@zmdb/schema-core';
import type { ColumnKeys, DeclaredTable } from '@zmdb/schema-core/derive';
import type { WhereDTO } from '@zmdb/schema-core/dto';
import { schemaFromIR } from '@zmdb/schema-core/ir';
import type {
  Ext,
  Fts,
  HasDefault,
  Length,
  Max,
  MaxLength,
  Min,
  Pattern,
  PrimaryKey,
  References,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
} from '@zmdb/schema-core/tags';
import { describe, it, expect } from 'vitest';

import { mssql } from '../../mssql/src/index.js';
import { defineRepository, type Driver } from './index.js';

/** The payload of the json column. Erased in a column map; carried in the IR. */
export interface Settings {
  theme: string;
}

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\S+@\\S+$'>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  score: (number & Sql<'numeric'>) | null;
  visits: bigint & Sql<'bigint'>;
  bio: (string & Sql<'text'> & MaxLength<2000>) | null;
  // `HasDefault` says a default exists, not what it is: a type cannot carry a runtime value, so
  // the value belongs to the migration. The flag is the half that has to survive, because it is
  // what keeps the column out of `CreateDTO`.
  active: boolean & Sql<'boolean'> & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  role: ('admin' | 'editor' | 'viewer') & HasDefault;
  settings: Settings & Sql<'json'>;
  passwordHash: string & Sql<'text'> & Sensitive;
}

export interface Membership extends Table<'memberships'> {
  userId: number & Sql<'integer'> & PrimaryKey & References<'users.id'>;
  groupId: number & Sql<'integer'> & PrimaryKey;
  note: (string & Sql<'text'>) | null;
}

export interface Document extends Table<'documents'>, Fts<true> {
  slug: string & Sql<'text'> & PrimaryKey;
  body: string & Sql<'text'>;
}

export interface VectorItem extends Table<'vector_items'> {
  id: number & Sql<'integer'> & PrimaryKey;
  embedding: readonly number[] & Ext<'vector', 'vector', [3]>;
}

const {
  Document: Documents,
  Membership: Memberships,
  User: Users,
  VectorItem: VectorItems,
} = schemasFrom<{ User: User; Membership: Membership; Document: Document; VectorItem: VectorItem }>(import.meta.url, [
  'User',
  'Membership',
  'Document',
  'VectorItem',
]);

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql', 'sqlite', 'mssql'];
const EMPTY: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

function target(dialect: Dialect): DialectTarget {
  return dialect === 'mssql' ? mssql : dialect;
}

/**
 * What one table has to supply to be driven through every repository method.
 *
 * Every field is derived from the declared type, which is the point: the payload below is
 * checked against `CreateDTO<T>` rather than being a `Record<string, unknown>` the compiler
 * waves through. The previous version of this file looked up the payload by table name and
 * so could — and did — pass `{}`.
 */
interface Probe<T extends DeclaredTable> {
  readonly pk: PrimaryKeyOf<T>;
  /** One column to filter and order by. Which one does not matter; that there is one does. */
  readonly column: ColumnKeys<T> & string;
  /** An equality filter, and the same column under an operator — two different compilers. */
  readonly where: WhereDTO<T>;
  readonly operator: WhereDTO<T>;
  readonly create: CreateDTO<T>;
}

/** Every read this repository can run, as SQL, for one schema. */
async function everySql<T extends DeclaredTable>(
  schema: TaggedSchema<T>,
  dialect: Dialect,
  { pk, column, where, operator }: Probe<T>,
): Promise<readonly unknown[]> {
  const compiled: unknown[] = [];
  const driver: Driver = {
    execute: async query => {
      compiled.push(query);
      // One row back, so a method that reads its result keeps going instead of
      // short-circuiting on an empty set and compiling less SQL than it should.
      return [{ id: 1, userId: 1, groupId: 2, slug: 'a', email: 'a@b.com' }];
    },
  };
  const repo = defineRepository(schema, driver, { dialect: target(dialect) });

  await repo.findById(pk);
  await repo.findAll();
  await repo.find(where);
  await repo.findOne(operator);
  await repo.list({
    where,
    orderBy: [{ column, dir: 'desc' }],
    page: { limit: 10, offset: 5 },
  });
  await repo.aggregate({ computed: { total: { fn: 'count' } } });
  return compiled;
}

/** The `CREATE TABLE` a migration would write for one schema, in one dialect. */
function ddl(schema: CoreSchema<string>, dialect: Dialect): readonly string[] {
  return diff(EMPTY, snapshot([schema]), { dialect: target(dialect) }).map(op =>
    dialect === 'mssql' ? mssql.migrations.emitUp(op) : emitUp(op, dialect),
  );
}

describe('the DDL a tagged declaration reaches the database as', () => {
  // Written out, one string per dialect, rather than compared against a second producer. The
  // four lines are the reason the IR carries an abstract `SqlType` instead of rendered SQL:
  // `SERIAL` against `INT AUTO_INCREMENT` against a bare `INTEGER`, a native `JSONB` against
  // `JSON` against `TEXT`, `TIMESTAMPTZ` against `DATETIME(3)` against `TEXT`. A differential
  // could only ever say the two sides agreed, which is why nobody had read these strings.

  it('renders every column type for postgres', () => {
    expect(ddl(Users, 'postgres')).toEqual([
      'CREATE TABLE "users" ("active" BOOLEAN NOT NULL, "age" INTEGER NOT NULL, "bio" TEXT, ' +
        '"createdAt" TIMESTAMPTZ NOT NULL, "email" VARCHAR(255) NOT NULL, "id" SERIAL PRIMARY KEY, ' +
        '"passwordHash" TEXT NOT NULL, "role" TEXT NOT NULL, "score" NUMERIC, "settings" JSONB NOT NULL, ' +
        '"visits" BIGINT NOT NULL)',
    ]);
  });

  it('renders every column type for mysql', () => {
    expect(ddl(Users, 'mysql')).toEqual([
      'CREATE TABLE `users` (`active` TINYINT(1) NOT NULL, `age` INT NOT NULL, `bio` TEXT, ' +
        '`createdAt` DATETIME(3) NOT NULL, `email` VARCHAR(255) NOT NULL, `id` INT AUTO_INCREMENT PRIMARY KEY, ' +
        '`passwordHash` TEXT NOT NULL, `role` TEXT NOT NULL, `score` DECIMAL, `settings` JSON NOT NULL, ' +
        '`visits` BIGINT NOT NULL)',
    ]);
  });

  it('renders every column type for sqlite', () => {
    expect(ddl(Users, 'sqlite')).toEqual([
      'CREATE TABLE "users" ("active" INTEGER NOT NULL, "age" INTEGER NOT NULL, "bio" TEXT, ' +
        '"createdAt" TEXT NOT NULL, "email" TEXT NOT NULL, "id" INTEGER PRIMARY KEY, ' +
        '"passwordHash" TEXT NOT NULL, "role" TEXT NOT NULL, "score" NUMERIC, "settings" TEXT NOT NULL, ' +
        '"visits" INTEGER NOT NULL)',
    ]);
  });

  it('renders every column type for mssql', () => {
    expect(ddl(Users, 'mssql')).toEqual([
      'CREATE TABLE [users] ([active] BIT NOT NULL, [age] INT NOT NULL, [bio] NVARCHAR(MAX), ' +
        '[createdAt] DATETIMEOFFSET(3) NOT NULL, [email] NVARCHAR(255) NOT NULL, ' +
        '[id] INT IDENTITY(1,1) PRIMARY KEY, [passwordHash] NVARCHAR(MAX) NOT NULL, ' +
        '[role] NVARCHAR(MAX) NOT NULL, [score] DECIMAL, [settings] NVARCHAR(MAX) NOT NULL, ' +
        '[visits] BIGINT NOT NULL)',
    ]);
  });

  it('carries an extension type from the declaration through the snapshot into ordered DDL', () => {
    const taken = snapshot([VectorItems]);
    expect(taken.extensions).toEqual([{ name: 'vector' }]);
    expect(taken.tables[0]?.columns.find(column => column.name === 'embedding')?.type).toEqual({
      extension: 'vector',
      name: 'vector',
      args: [3],
    });
    expect(ddl(VectorItems, 'postgres')).toEqual([
      'CREATE EXTENSION IF NOT EXISTS "vector"',
      'CREATE TABLE "vector_items" ("embedding" vector(3) NOT NULL, "id" INTEGER PRIMARY KEY)',
    ]);
  });

  it('names every declared column in every dialect', () => {
    // The three strings above are a record of one renderer at one moment; this is the claim
    // that does not depend on it. A column missing from the DDL is a column the application
    // writes to and the database has never heard of.
    for (const dialect of DIALECTS) {
      const create = ddl(Users, dialect)[0] ?? '';
      expect(create, dialect).toContain('CREATE TABLE');
      for (const column of Object.keys(Users.columns)) {
        expect(create, `${dialect}: ${column}`).toContain(column);
      }
    }
  });

  it('keeps unique constraints as a separate migration gap while emitting foreign keys', () => {
    expect(Users.columns.email?.flags.unique).toBe(true);
    expect(Memberships.ir.columns.find(column => column.name === 'userId')?.references).toBe('users.id');
    for (const dialect of DIALECTS) {
      expect(ddl(Users, dialect)[0], dialect).not.toContain('UNIQUE');
      const statements = ddl(Memberships, dialect).join('; ');
      expect(statements, dialect).toContain('REFERENCES');
      expect(statements, dialect).toContain('ON DELETE NO ACTION ON UPDATE NO ACTION');
    }
  });

  it('emits a composite primary key as one ordered table constraint', () => {
    expect(Memberships.primaryKey).toEqual(['userId', 'groupId']);
    expect(ddl(Memberships, 'postgres')[0]).toBe(
      'CREATE TABLE "memberships" ("groupId" INTEGER NOT NULL, "note" TEXT, "userId" INTEGER NOT NULL, ' +
        'PRIMARY KEY ("userId", "groupId"))',
    );
    expect(ddl(Memberships, 'mysql')[0]).toBe(
      'CREATE TABLE `memberships` (`groupId` INT NOT NULL, `note` TEXT, `userId` INT NOT NULL, ' +
        'PRIMARY KEY (`userId`, `groupId`))',
    );
    expect(ddl(Memberships, 'sqlite')[0]).toBe(
      'CREATE TABLE "memberships" ("groupId" INTEGER NOT NULL, "note" TEXT, "userId" INTEGER NOT NULL, ' +
        'PRIMARY KEY ("userId", "groupId"), FOREIGN KEY ("userId") REFERENCES "users" ("id") ' +
        'ON DELETE NO ACTION ON UPDATE NO ACTION)',
    );
    expect(ddl(Memberships, 'mssql')[0]).toBe(
      'CREATE TABLE [memberships] ([groupId] INT NOT NULL, [note] NVARCHAR(MAX), [userId] INT NOT NULL, ' +
        'PRIMARY KEY ([userId], [groupId]))',
    );
  });

  it('does not ask the migration for the FTS table the declaration wanted', () => {
    // Third instance of the same gap, and the reason the flag is checked on the value and not
    // in the SQL: `Fts<true>` survives the whole front-end and the emitter has no op for it.
    expect(Documents.ftsTable).toBe(true);
    expect(Documents.ir.ftsTable).toBe(true);
    for (const dialect of DIALECTS) {
      expect(ddl(Documents, dialect), dialect).toHaveLength(1);
    }
  });
});

it('executes a MySQL repository delete without unsupported RETURNING', async () => {
  const calls: CompiledQuery[] = [];
  const driver: Driver = {
    dialect: 'mysql',
    execute(query) {
      calls.push(query);
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  };
  const repo = defineRepository(Users, driver, { dialect: 'mysql' });

  await expect(repo.delete(7)).resolves.toBe(true);
  expect(calls).toEqual([
    {
      text: 'DELETE FROM `users` WHERE `id` = ?',
      parameters: [7],
    },
  ]);
});

it('executes a SingleStore repository delete with inherited MySQL semantics', async () => {
  const calls: CompiledQuery[] = [];
  const driver: Driver = {
    dialect: 'singlestore',
    execute(query) {
      calls.push(query);
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  };
  const repo = defineRepository(Users, driver, { dialect: 'singlestore' });

  await expect(repo.delete(7)).resolves.toBe(true);
  expect(calls).toEqual([
    {
      text: 'DELETE FROM `users` WHERE `id` = ?',
      parameters: [7],
    },
  ]);
});

// One call per table rather than one loop over all three, because every DTO in here is
// derived from a different declared type and a loop would have to erase them back to
// `Record<string, unknown>` to have a single body.
function everyOperationCompiles<T extends DeclaredTable>(schema: TaggedSchema<T>, probe: Probe<T>): void {
  describe(schema.table, () => {
    for (const dialect of DIALECTS) {
      it(`compiles every read (${dialect})`, async () => {
        const compiled = await everySql(schema, dialect, probe);
        // Six calls, each of which has to have produced at least one query. A schema value
        // assembled at build time is data, and the way data goes wrong is a field that is
        // absent rather than an error that is raised — a method that read a missing flag and
        // returned early would leave the count short without throwing anything.
        expect(compiled.length).toBeGreaterThanOrEqual(6);
      });
    }

    it('accepts a write and compiles it', async () => {
      // `create` and `update` run the payload validator first, so this covers the validator
      // the schema value carries as well as the SQL: a missing `hasDefault` shows up as a
      // throw on a payload that should have been accepted, since the column would then be
      // required in `CreateDTO` and this DTO does not supply it.
      //
      // `settings` needs a real `theme`, and the old version of this file passed `{}`. That is
      // the gain from declaring the column as `Settings & Sql<'json'>` rather than calling
      // `json<Settings>()`: the payload shape reaches the IR, so the validator checks inside
      // the object instead of stopping at "it is one".
      const compiled: unknown[] = [];
      const driver: Driver = {
        execute: async query => {
          compiled.push(query);
          return [{ ...probe.create, id: 1 }];
        },
      };
      const repo = defineRepository(schema, driver);
      await repo.create(probe.create);
      await repo.upsert(probe.create);
      await repo.update(probe.pk, {});
      expect(compiled.length).toBeGreaterThan(2);
    });
  });
}

describe('every operation compiles, over an awkward schema', () => {
  everyOperationCompiles(Users, {
    pk: 1,
    column: 'email',
    where: { email: 'x' },
    operator: { email: { ne: 'nobody@example.com' } },
    create: {
      email: 'a@b.com',
      age: 30,
      visits: 1n,
      bio: null,
      score: null,
      settings: { theme: 'dark' },
      passwordHash: 'x',
    },
  });
  everyOperationCompiles(Memberships, {
    pk: { userId: 1, groupId: 2 },
    column: 'groupId',
    where: { groupId: 2 },
    operator: { groupId: { ne: 0 } },
    create: { userId: 1, groupId: 2, note: null },
  });
  everyOperationCompiles(Documents, {
    pk: 'a',
    column: 'body',
    where: { body: 'x' },
    operator: { body: { ne: '' } },
    create: { slug: 'a', body: 'b' },
  });
});

describe('the schema value is a projection of the IR it carries', () => {
  for (const schema of [Users, Memberships, Documents]) {
    it(`${schema.table} rebuilds itself from its own IR`, () => {
      // The invariant that replaces the old differential, and the one `CoreSchema.ir` has to
      // hold for either half to be safe to read: `table`, `columns`, `primaryKey` and
      // `ftsTable` are a function of the IR, so projecting them again is the identity. The day
      // they can disagree is the day two consumers of one schema see two different tables.
      expect(schemaFromIR(schema.ir)).toEqual(schema);
    });
  }
});
