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
// with a payload shape, and an FTS table. Two of those turn out to be dropped on the way to the
// DDL and one of them produces SQL no dialect will accept — see below. The old version could
// not have noticed any of it, because both sides of the comparison were wrong in the same way.

import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { Dialect } from '@zmdb/query-compiler';
import { diff, emitUp, snapshot, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';
import type { CoreSchema } from '@zmdb/schema-core';
import { schemaFromIR } from '@zmdb/schema-core/ir';
import type {
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

import { defineRepository, type Driver } from './index.ts';

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

const {
  Document: Documents,
  Membership: Memberships,
  User: Users,
} = schemasFrom(import.meta.url, ['User', 'Membership', 'Document']);

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql', 'sqlite'];
const EMPTY: SchemaSnapshot = { version: 1, tables: [] };

/** Every operation this repository can run, as SQL, for one schema. */
async function everySql(schema: CoreSchema<string>, dialect: Dialect): Promise<readonly unknown[]> {
  const compiled: unknown[] = [];
  const driver: Driver = {
    execute: async query => {
      compiled.push(query);
      // One row back, so a method that reads its result keeps going instead of
      // short-circuiting on an empty set and compiling less SQL than it should.
      return [{ id: 1, userId: 1, groupId: 2, slug: 'a', email: 'a@b.com' }];
    },
  };
  const repo = defineRepository(schema, driver, { dialect });
  const pk = schema.primaryKey.length > 1 ? { userId: 1, groupId: 2 } : 1;
  const first = Object.keys(schema.columns)[1] ?? 'id';

  await repo.findById(pk);
  await repo.findAll();
  await repo.find({ [first]: 'x' });
  await repo.findOne({ [first]: { ne: null } });
  await repo.list({
    where: { [first]: 'x' },
    orderBy: [{ column: first, dir: 'desc' }],
    page: { limit: 10, offset: 5 },
  });
  await repo.aggregate({ computed: { total: { fn: 'count' } } });
  await repo.delete(pk);
  return compiled;
}

/** The `CREATE TABLE` a migration would write for one schema, in one dialect. */
function ddl(schema: CoreSchema<string>, dialect: Dialect): readonly string[] {
  return diff(EMPTY, snapshot([schema])).map(op => emitUp(op, dialect));
}

describe('the DDL a tagged declaration reaches the database as', () => {
  // Written out, one string per dialect, rather than compared against a second producer. The
  // three lines are the reason the IR carries an abstract `SqlType` instead of rendered SQL:
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

  it('drops the unique constraint and the foreign key on the way to the DDL', () => {
    // Not an assertion about what the DDL *should* say. `ColumnSnapshot` in
    // `@zmdb/query-compiler/migrations` models four facts — name, type, nullable, primary key —
    // plus a length, and its header says as much. So `Unique` and `References` reach the schema
    // value, reach the IR, and then stop: the query compiler uses them, and the migration
    // emitter has nowhere to put them.
    //
    // This is pinned rather than fixed because widening the snapshot model is a change to the
    // migration format, which is a separate piece of work from the front-end this suite is
    // about. Pinned so that work is a failing test here rather than a discovery.
    expect(Users.columns.email?.flags.unique).toBe(true);
    expect(Memberships.ir.columns.find(column => column.name === 'userId')?.references).toBe('users.id');
    for (const dialect of DIALECTS) {
      expect(ddl(Users, dialect)[0], dialect).not.toContain('UNIQUE');
      expect(ddl(Memberships, dialect)[0], dialect).not.toContain('REFERENCES');
    }
  });

  it('emits a composite primary key as two column constraints, which no dialect accepts', () => {
    expect(Memberships.primaryKey).toEqual(['userId', 'groupId']);
    // The same limitation, one step worse. `ddlType` writes ` PRIMARY KEY` per column that
    // carries the flag, so a two-column key comes out as two of them — and postgres, mysql and
    // sqlite all reject that outright rather than picking one. A composite key has to be a
    // table-level `PRIMARY KEY (a, b)` clause, which needs the whole column list at once.
    //
    // Held here, deliberately failing to be right, because it is real: nobody can migrate this
    // table today. Fixing it means `create_table` learning about keys, which is the same change
    // to the migration format as the constraint gap above.
    for (const dialect of DIALECTS) {
      const create = ddl(Memberships, dialect)[0] ?? '';
      expect(create.match(/PRIMARY KEY/g), dialect).toHaveLength(2);
    }
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

describe('every operation compiles, over an awkward schema', () => {
  for (const schema of [Users, Memberships, Documents]) {
    describe(schema.table, () => {
      for (const dialect of DIALECTS) {
        it(`compiles every read (${dialect})`, async () => {
          const compiled = await everySql(schema, dialect);
          // Seven calls, each of which has to have produced at least one query. A schema value
          // assembled at build time is data, and the way data goes wrong is a field that is
          // absent rather than an error that is raised — a method that read a missing flag and
          // returned early would leave the count short without throwing anything.
          expect(compiled.length).toBeGreaterThan(6);
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
        const dto: Record<string, unknown> =
          {
            users: {
              email: 'a@b.com',
              age: 30,
              visits: 1n,
              bio: null,
              score: null,
              settings: { theme: 'dark' },
              passwordHash: 'x',
            },
            memberships: { userId: 1, groupId: 2, note: null },
            documents: { slug: 'a', body: 'b' },
          }[schema.table] ?? {};

        const compiled: unknown[] = [];
        const driver: Driver = {
          execute: async query => {
            compiled.push(query);
            return [{ ...dto, id: 1 }];
          },
        };
        const repo = defineRepository(schema, driver);
        await repo.create(dto);
        await repo.upsert(dto);
        await repo.update(schema.primaryKey.length > 1 ? { userId: 1, groupId: 2 } : 1, {});
        expect(compiled.length).toBeGreaterThan(2);
      });
    });
  }
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
