import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core';

export interface CompilerFixtureUser extends Table<'compiler_fixture_users'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly email: string & Sql<'text'>;
}
