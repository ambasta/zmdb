import { UnsupportedFeatureError } from '../errors.js';
import type { DatabaseCapabilities, ResolvedDialectTraits, ReturningStatement, SqlDialect } from './protocol.js';

export { defineSqlDialect, DIALECT_SQL_TYPES, extendSqlDialect, isSqlDialect } from './protocol.js';
export type {
  AppliedMigration,
  DatabaseCapabilities,
  DialectCompiler,
  DialectOutbox,
  DialectReturningColumn,
  DialectReturningContext,
  DialectReturningSql,
  DialectSqlType,
  DialectTypeMap,
  DialectUpsertConflict,
  DialectUpsertContext,
  DialectUpsertReferences,
  IntrospectionDriver,
  Introspector,
  IntrospectOptions,
  MigrationConnection,
  MigrationDialect,
  MigrationDriver,
  MigrationExecutionDriver,
  MigrationPlan,
  MigrationTableOptions,
  PaginationTail,
  PlaceholderStyle,
  ResolvedDialectTraits,
  ReturningCapability,
  ReturningStatement,
  ReturningStyle,
  SchemaObjectOperation,
  SqlDialect,
  SqlDialectDefinition,
  SqlDialectExtension,
} from './protocol.js';

/**
 * The generic compiler accepts one resolved, immutable dialect object.
 *
 * Official database names, selection and inheritance live in their database
 * packages. A third-party dialect therefore reaches this package through the
 * same structural contract without registration or a generic-package edit.
 */
export type DialectTarget<Name extends string = string> = SqlDialect<Name>;

export type DialectFeature =
  | 'materializedView'
  | 'rowLevelSecurity'
  | 'sequences'
  | 'schemas'
  | 'partialIndex'
  | 'generatedColumns'
  | 'transactionalDdl'
  | 'foreignKeys';

export function dialectName(dialect: DialectTarget): string {
  return dialect.name;
}

export function dialectFamily(dialect: DialectTarget): string {
  return dialect.family;
}

export function dialectTraits(dialect: DialectTarget): ResolvedDialectTraits {
  return dialect.traits;
}

export function dialectCapabilities(dialect: DialectTarget): DatabaseCapabilities {
  return dialect.capabilities;
}

export function dialectSupportsReturning(dialect: DialectTarget, statement: ReturningStatement): boolean {
  return dialect.capabilities.returning[statement];
}

function supportsFeature(dialect: SqlDialect, feature: DialectFeature): boolean {
  switch (feature) {
    case 'rowLevelSecurity':
      return dialect.capabilities.rowLevelSecurity;
    case 'sequences':
      return dialect.capabilities.sequences;
    case 'schemas':
      return dialect.capabilities.schemas;
    case 'partialIndex':
      return dialect.capabilities.partialIndexes;
    case 'generatedColumns':
      return dialect.capabilities.generatedColumns;
    case 'transactionalDdl':
      return dialect.capabilities.transactionalDdl;
    case 'foreignKeys':
      return dialect.capabilities.foreignKeys;
    case 'materializedView':
      return false;
  }
}

export function requireDialectFeature(dialect: DialectTarget, feature: DialectFeature, errorFeature: string): void {
  if (!supportsFeature(dialect, feature)) {
    throw new UnsupportedFeatureError(errorFeature, dialect.name);
  }
}
