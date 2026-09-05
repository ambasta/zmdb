// The naming-strategy fixture is compiled by the reflection session, never run by
// Vitest. It keeps the application-facing properties camelCase while the tests hand
// the reflector a literal build-time strategy.

import type { Physical, PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';

function namingCase<T>(_label: string, _value?: T): void {}

export interface CamelCaseUser extends Table<'userAccount'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'>;
}
namingCase<CamelCaseUser>('camel-case');

export interface ExplicitColumnUser extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'> & Physical<'created_ts'>;
}
namingCase<ExplicitColumnUser>('explicit-column');

export interface ExplicitTableUser extends Table<'userAccount'>, Physical<'legacy_users'> {
  id: number & Sql<'integer'> & PrimaryKey;
}
namingCase<ExplicitTableUser>('explicit-table');

export interface CollidingColumns extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'>;
  created_at: Date & Sql<'timestamp'>;
}
namingCase<CollidingColumns>('collision');
