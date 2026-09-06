import { assert } from '@zmdb/aot-validator/utilities';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { BaseRepository, defineRepository, type Driver } from '@zmdb/repository';
import { createTransactionalDb, type TxConnection } from '@zmdb/repository/transactions';
import { applyOrderBy, buildListResult, compileWhere } from '@zmdb/schema-core/dto';
import { sqliteDriver, sqlite } from '@zmdb/sqlite';
import { schemaOf } from 'zmdb';
import type { CreateDTO, Entity, UpdateDTO } from 'zmdb/derive';
import type { HasDefault, Min, Pattern, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

// #region snippet-1
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'>;
  role: ('admin' | 'user') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'> & Min<0>;
}
// #endregion snippet-1

// #region snippet-2
type Row = Entity<User>;
//   { id: number; email: string; role: 'admin' | 'user'; createdAt: Date }

type CreateUser = CreateDTO<User>;
//   { email: string; role?: 'admin' | 'user'; createdAt?: Date }   ← id absent (Serial); HasDefault → optional

type UpdateUser = UpdateDTO<User>; //  Partial<CreateUser>
// #endregion snippet-2

const db = {} as any;
const driver: Driver = { dialect: sqlite, execute: async () => [] };
const connection: TxConnection = { raw: async () => {}, execute: async () => [] };
const req = new Request('http://localhost');
const since = new Date();
const users = defineRepository(schemaOf<User>(), sqliteDriver(db));
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(db));

// #region snippet-3
{
  (async () => {
    const sqliteDb = {} as any;
    const userRepo = defineRepository(schemaOf<User>(), sqliteDriver(sqliteDb));

    const u = await userRepo.create({ email: 'a@b.com' }); // validated vs CreateDTO<S>
    const one = await userRepo.findById(u.id); // Entity<S> | undefined
    const admins = await userRepo.find({ role: 'admin' }); // typed WhereDTO<S>
    const page = await userRepo.list({ page: { limit: 20 } }); // ListResult<Entity<S>>
    const updated = await userRepo.update(u.id, { role: 'admin' }); // UpdatePatch<S>; plain values validate as UpdateDTO<S>
    const gone = await userRepo.delete(u.id); // boolean
  })();
}
// #endregion snippet-3

// #region snippet-4
{
  const userSchema = schemaOf<User>();
  class UserRepository extends BaseRepository<User> {
    static override readonly schema = userSchema;
  }
  const usersRepo = new UserRepository(sqliteDriver(db));
}
// #endregion snippet-4

// #region snippet-5
{
  (async () => {
    const qbCompiler = createQueryCompiler(sqlite);
    let qb = qbCompiler.selectFrom('users');
    qb = compileWhere(qb, { role: 'admin', createdAt: { gte: since } } as any);
    qb = applyOrderBy(qb, [{ column: 'createdAt', dir: 'desc' }]);
    const rows = await driver.execute(qb.limit(21).compile());
    const page = buildListResult(rows, { limit: 20 }); // { items, hasMore }
  })();
}
// #endregion snippet-5

// #region snippet-6
{
  (async () => {
    const txDb = createTransactionalDb(connection);
    await txDb.transaction(async tx => {
      // withTransaction re-binds a repository onto the transaction's connection
      const user = await users.withTransaction(tx).create({ email: 'a@b.com' });
      const order = await orders.withTransaction(tx).create({ userId: user.id, total: 42 });
      // throw here → ROLLBACK; clean return → COMMIT
    });
  })();
}
// #endregion snippet-6

// #region snippet-7
{
  (async () => {
    // In an HTTP handler: validate the inbound body against the derived Create DTO.
    const payload = assert<CreateDTO<User>>(await req.json());
    const createdUser = await users.create(payload);
  })();
}
// #endregion snippet-7
