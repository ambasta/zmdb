import { type DialectTarget, type Introspector } from '@zmdb/query-compiler';

export function configuredDialect(dialect: DialectTarget): DialectTarget {
  return dialect;
}

export function configuredIntrospector(dialect: DialectTarget): Introspector {
  return dialect.introspector;
}
