import type { CreateDTO, Entity, UpdateDTO } from 'zmdb/derive';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user' | 'guest') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

// #region snippet-1
{
  // interface User extends Table<'users'> { … } — see Schema Declaration.

  type UserRow = Entity<User>;
  // { id: number; email: string; role: 'admin'|'user'|'guest'; createdAt: Date }

  type CreateUser = CreateDTO<User>;
  // { email: string; role?: 'admin'|'user'|'guest' }
  //   id omitted (Serial); role/createdAt optional (HasDefault)

  type UpdateUser = UpdateDTO<User>;
  // every column optional, minus the serial ones and the primary key
}
// #endregion snippet-1
