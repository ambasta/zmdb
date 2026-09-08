import { type PrimaryKey, type Serial, type Sql, type Table } from '@zmdb/schema/tags';
import { is } from '@zmdb/validator';

export interface CompilerFixtureUser extends Table<'compiler_fixture_users'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly email: string & Sql<'text'>;
}

export function acceptsCompilerFixtureUser(value: unknown): value is CompilerFixtureUser {
  return is<CompilerFixtureUser>(value);
}
