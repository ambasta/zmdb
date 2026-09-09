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
  interface Money {
    amount: number;
    currency: string;
  }

  //                       wire    app     db
  const MoneyType = defineType<string, Money, string>({
    sqlType: 'VARCHAR(50)',
    toDb: m => `${m.amount}:${m.currency}`,
    fromDb: s => {
      const [amount, currency] = s.split(':');
      return { amount: Number(amount), currency };
    },
    toWire: m => `${m.amount} ${m.currency}`,
    fromWire: s => {
      const [amount, currency] = s.split(' ');
      return { amount: Number(amount), currency };
    },
  });

  // Usage
  const dbValue = encodeValue(MoneyType, { amount: 100, currency: 'USD' });
  // dbValue => "100:USD"

  const appValue = decodeValue(MoneyType, '100:USD');
  // appValue => { amount: 100, currency: 'USD' }
}
// #endregion snippet-1

// #region snippet-2
export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  total: Money & Sql<'varchar'> & Codec<'Money'> & WireAs<string>;
}
// #endregion snippet-2

// #region snippet-3
{
  const codecs = { Money: wireCodec(MoneyType) };

  const decode = wireDecoder(schemaOf<Order>(), 'create', codecs);
  const encode = wireEncoder(schemaOf<Order>(), codecs);
}
// #endregion snippet-3

// #region snippet-4
interface Priority {
  level: 'low' | 'medium' | 'high';
  escalated: boolean;
}

export interface Task extends Table<'tasks'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  priority: Priority & Sql<'json'>;
}
// #endregion snippet-4

// #region snippet-5
{
  // a codec that does need one: the stored text is not the app shape
  const PriorityType = defineType<string, Priority, string>({
    sqlType: 'JSONB',
    toDb: p => JSON.stringify(p),
    // the column is JSONB; nothing guarantees the shape on read, so check it
    fromDb: raw => assert<Priority>(JSON.parse(raw)),
    toWire: p => JSON.stringify(p),
    fromWire: raw => assert<Priority>(JSON.parse(raw)),
  });
}
// #endregion snippet-5

// #region snippet-6
{
  // This compiles — types align
  const encoded = encodeValue(MoneyType, { amount: 50, currency: 'EUR' });

  // This fails — fromDb expects string, not number
  // decodeValue(MoneyType, 42); // Type error
}
// #endregion snippet-6
