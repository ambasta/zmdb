// The naming-strategy fixture is compiled by the reflection session, never run by
// Vitest. It keeps the application-facing properties camelCase while the tests hand
// the reflector a literal build-time strategy.

import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';

// FROZEN SURFACE (#417): `Physical<Name>` does not ship yet. Giving the local
// unique symbol the frozen public basename lets the real reflector observe today's
// unknown tag and lets the implementation slice recognise it through TAG_NAMES.
// A real `const`, rather than `declare const`, keeps this fixture honest under the
// same compiler settings as an application.
const zmdbPhysical = Symbol('zmdbPhysical');
type Physical<Name extends string> = { readonly [zmdbPhysical]?: Name };

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

export interface CollidingColumns extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'>;
  created_at: Date & Sql<'timestamp'>;
}
namingCase<CollidingColumns>('collision');
