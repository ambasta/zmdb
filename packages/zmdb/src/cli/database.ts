import { createIntrospector } from '@zmdb/migrations/introspect';
import { mssql } from '@zmdb/mssql';
import { type DialectTarget, type Introspector } from '@zmdb/query-compiler';
import { sqliteIntrospector } from '@zmdb/sqlite';

export function configuredDialect(dialect: DialectTarget): DialectTarget {
  return dialect === 'mssql' ? mssql : dialect;
}

export function configuredIntrospector(dialect: DialectTarget): Introspector {
  const selected = configuredDialect(dialect);
  if (typeof selected !== 'string') return selected.introspector;
  if (selected === 'sqlite') return sqliteIntrospector;
  return createIntrospector(selected);
}
