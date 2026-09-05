import { createQueryCompiler } from '@zmdb/query-compiler';
import { defineRepository, schemaOf } from 'zmdb';
import type { CreateDTO, Entity, UpdateDTO } from 'zmdb/derive';
import type { HasDefault, Length, PrimaryKey, References, Serial, Sql, Table, Unique } from 'zmdb/tags';

const driver = {} as any;

// #region snippet-1
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique;
  name: (string & Sql<'text'>) | null;
  role: ('admin' | 'user') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
// #endregion snippet-1

// #region snippet-2
type FieldExample = {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  // ^^          ^^^^^^^^^^^^^^^^ the SQL column type
  // the type your code sees      ^^^^^^^^^^^^^^^^^^ facts about the column
};
// #endregion snippet-2

// #region snippet-3
{
  (async () => {
    type Row = Entity<User>;
    // { id: number; email: string; name: string | null; role: 'admin' | 'user'; createdAt: Date }

    type NewUser = CreateDTO<User>;
    // { email: string; name?: string | null; role?: 'admin' | 'user'; createdAt?: Date }
    // no `id`: it is Serial, so the database makes it

    type Patch = UpdateDTO<User>;
    // every field optional

    const users = defineRepository(schemaOf<User>(), driver);
    await users.create({ email: 'a@b.com' }); // validated before any SQL is sent
  })();
}
// #endregion snippet-3

// #region snippet-4
{
  // what you write
  const users = defineRepository(schemaOf<User>(), driver);

  // what runs
  const usersCompiled = defineRepository(schemaOf<User>(), driver);
}
// #endregion snippet-4

// #region snippet-5
export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  authorId: number & Sql<'integer'> & References<'users.id'>;
}
// #endregion snippet-5

// #region snippet-6
interface Preferences {
  theme: 'light' | 'dark';
  digest: boolean;
}

export interface Account extends Table<'accounts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  prefs: Preferences & Sql<'json'>;
}

type AccountRow = Entity<Account>;
// Row['prefs']['theme'] is 'light' | 'dark'
// #endregion snippet-6

// #region snippet-7
{
  const schema = schemaOf<User>();
  const compiler = createQueryCompiler('postgres');
  const query = compiler.selectFrom(schema.table).select(['id', 'email']).where('role', '=', 'admin').compile();
}
// #endregion snippet-7
