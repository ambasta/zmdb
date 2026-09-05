import { type Dialect, type Introspector } from '@zmdb/query-compiler';
import { createIntrospector } from '@zmdb/query-compiler/introspect';
import { sqliteIntrospector } from '@zmdb/sqlite';

export function configuredIntrospector(dialect: Dialect): Introspector {
  return dialect === 'sqlite' ? sqliteIntrospector : createIntrospector(dialect);
}
