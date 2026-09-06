import { is } from '@zmdb/aot-validator/utilities';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

export interface CompilerFixtureUser extends Table<'compiler_fixture_users'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly email: string & Sql<'text'>;
}

export function acceptsCompilerFixtureUser(value: unknown): value is CompilerFixtureUser {
  return is<CompilerFixtureUser>(value);
}
