import { type DialectTarget, type Introspector } from '@zmdb/sql';

export function configuredDialect(dialect: DialectTarget): DialectTarget {
  return dialect;
}

export function configuredIntrospector(dialect: DialectTarget): Introspector {
  return dialect.introspector;
}
