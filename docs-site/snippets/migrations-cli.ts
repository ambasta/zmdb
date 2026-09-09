import { assert, is, validate } from '@zmdb/aot-validator';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { BaseRepository, type Driver } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/sqlite';
import { defineRepository, schemaOf } from 'zmdb';
import type { CreateDTO, Entity, UpdateDTO, Populated } from 'zmdb/derive';
import type {
  HasDefault,
  Length,
  Max,
  MaxLength,
  Min,
  Pattern,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
  Unique,
} from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\.[^@]+$'>;
  name?: string & Sql<'text'>;
  role: ('admin' | 'user' | 'guest') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'> & Min<0>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  authorId: number & Sql<'integer'> & References<'users.id'>;
}

const db = {} as any;
const driver: Driver = { dialect: 'sqlite', execute: async () => [] };
const users = defineRepository(schemaOf<User>(), sqliteDriver(db), { dialect: 'sqlite' });
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(db), { dialect: 'sqlite' });
const posts = defineRepository(schemaOf<Post>(), sqliteDriver(db), { dialect: 'sqlite' });
const qb = createQueryCompiler('sqlite');
const compiler = qb;
const builder = qb.selectFrom('users');

// #region snippet-1
{
  const migrations: readonly Migration[] = [
    {
      version: 1,
      name: 'create_users_table',
      up: `CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL)`,
      down: `DROP TABLE "users"`,
    },
    {
      version: 2,
      name: 'add_email_column',
      up: `ALTER TABLE "users" ADD COLUMN "email" TEXT`,
      down: `ALTER TABLE "users" DROP COLUMN "email"`,
    },
  ];

  const conn = new MyMigrationConnection();

  // Apply pending migrations
  const output = runCli('up', conn, migrations);
  // output => "applied: 1, 2"
}
// #endregion snippet-1

// #region snippet-2
{
  const output = runCli('down', conn, migrations);
  // output => "reverted: 2"
}
// #endregion snippet-2

// #region snippet-3
{
  const output = runCli('status', conn, migrations);
  // Output:
  // [x] 1 create_users_table
  // [x] 2 add_email_column
}
// #endregion snippet-3

// #region snippet-4
export interface MigrationConnection {
  exec(sql: string): void;
  appliedVersions(): readonly number[];
  recordApplied(version: number, name: string): void;
  recordReverted(version: number): void;
}
// #endregion snippet-4

// #region snippet-5
{
  class SqliteMigrationConnection implements MigrationConnection {
    constructor(private db: Database) {}

    exec(sql: string): void {
      this.db.exec(sql);
    }

    appliedVersions(): readonly number[] {
      const rows = this.db.prepare('SELECT version FROM _zmdb_migrations').all();
      return rows.map(r => Number(r.version));
    }

    recordApplied(version: number, name: string): void {
      this.db
        .prepare('INSERT INTO _zmdb_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(version, name, Date.now());
    }

    recordReverted(version: number): void {
      this.db.prepare('DELETE FROM _zmdb_migrations WHERE version = ?').run(version);
    }
  }
}
// #endregion snippet-5
