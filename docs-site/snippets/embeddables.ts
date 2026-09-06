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
  interface Address {
    street: string;
    city: string;
    zip: string;
    country: string;
  }

  export interface Customer extends Table<'customers'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    name: string & Sql<'text'>;
    // the embeddable, one column per field
    address_street: string & Sql<'text'>;
    address_city: string & Sql<'text'>;
    address_zip: string & Sql<'text'>;
    address_country: string & Sql<'text'>;
  }

  // Flatten for inserts/updates
  function toDbAddress(addr: Address): Record<string, unknown> {
    return flattenEmbeddable('address', addr);
  }

  // Lift from database rows
  function fromDbAddress(row: Record<string, unknown>): Address {
    // liftEmbeddable returns Record<string, unknown>; assert returns the narrowed value
    return assert<Address>(liftEmbeddable('address', row));
  }

  // Usage in repository
  const customerSchema = schemaOf<Customer>();

  class CustomerRepository extends BaseRepository<Customer> {
    async createWithAddress(data: { name: string; address: Address }) {
      const flat = { name: data.name, ...toDbAddress(data.address) };
      return this.create(flat);
    }

    async findById(id: number) {
      const row = await super.findById(id);
      if (!row) return null;
      return { ...row, address: fromDbAddress(row) };
    }
  }
}
// #endregion snippet-1

// #region snippet-2
interface OrderMetadata {
  source: string;
  priority: number;
  tags: string[];
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  metadata: OrderMetadata & Sql<'json'>;
}
// #endregion snippet-2

// #region snippet-3
{
  const result = validate<Address>(incomingAddress);
  if (!result.success) {
    throw new Error(result.errors!.map(e => `${e.path}: ${e.message}`).join(', '));
  }
  const address: Address = result.data!;
}
// #endregion snippet-3
