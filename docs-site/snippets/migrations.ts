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
  const currentState: SchemaSnapshot = snapshot([UserSchema, OrderSchema]);

  // currentState.version => 1
  // currentState.tables => [{ name: 'users', columns: [...], primaryKey: ['id'] }, ...]
}
// #endregion snippet-1

// #region snippet-2
{
  // After adding a new column
  const newState = snapshot([UserSchema, OrderSchema, ProductSchema]);

  const changes: readonly ChangeOp[] = diff(currentState, newState);

  // changes => [
  //   { kind: 'create_table', table: 'products', columns: [...], primaryKey: ['id'] },
  //   { kind: 'add_column', table: 'users', column: {...} }
  // ]
}
// #endregion snippet-2

// #region snippet-3
{
  for (const op of changes) {
    const upSql = emitUp(op, 'postgres');
    const downSql = emitDown(op, 'postgres');

    console.log('UP:', upSql);
    console.log('DOWN:', downSql);
  }

  // Output:
  // UP: ALTER TABLE "users" ADD COLUMN "new_col" TEXT NOT NULL
  // DOWN: ALTER TABLE "users" DROP COLUMN "new_col"
}
// #endregion snippet-3
