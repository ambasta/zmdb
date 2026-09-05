import { BaseRepository, type Driver } from '@zmdb/orm';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'>;
}

declare const driver: Driver;

class Users extends BaseRepository<User> {}

const repository: BaseRepository<User> = new Users(driver, 'sqlite');
const row: Promise<{ readonly id: number; readonly email: string } | undefined> = repository.findById(1);

void row;
