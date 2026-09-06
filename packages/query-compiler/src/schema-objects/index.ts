import type { DialectSqlType, MigrationDialect, SchemaObjectOperation, SqlDialect } from '../dialects/index.js';
import { UnsupportedFeatureError } from '../errors.js';
import type { ColumnSnapshot } from '../migrations/types.js';
import { quoteIdentifier } from '../quoting.js';
import type { GeneratedColumn, IndexDef, RlsPolicy, RoutineDef, SequenceDef, ViewDef } from './types.js';

export { UnsupportedFeatureError };
export { createExtensionDdl, type ExtensionDef } from './extensions.js';
export type {
  GeneratedColumn,
  IndexColumn,
  IndexDef,
  IndexMethod,
  RlsPolicy,
  RoutineDef,
  RoutineSqlType,
  SequenceDef,
  ViewDef,
} from './types.js';

export type DdlSqlType = DialectSqlType;

function migrationsOf(dialect: SqlDialect | MigrationDialect): MigrationDialect {
  return 'migrations' in dialect ? dialect.migrations : dialect;
}

function exactlyOne(dialect: SqlDialect, operation: SchemaObjectOperation): string {
  const statements = dialect.migrations.emitSchemaObject(operation);
  if (statements.length !== 1 || statements[0] === undefined) {
    throw new TypeError(`${dialect.name} schema-object emission must return exactly one statement`);
  }
  return statements[0];
}

export function ddlType(dialect: SqlDialect | MigrationDialect, column: ColumnSnapshot): string {
  return migrationsOf(dialect).ddlType(column);
}

export function quoteId(dialect: SqlDialect, id: string): string {
  return quoteIdentifier(dialect, id);
}

export function createIndexDdl(definition: IndexDef, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'create_index', definition });
}

export function checkConstraintDdl(table: string, name: string, expression: string, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'check_constraint', table, name, expression });
}

export function createViewDdl(definition: ViewDef, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'create_view', definition });
}

export function dropViewDdl(name: string, dialect: SqlDialect, materialized?: boolean): string {
  return exactlyOne(dialect, {
    kind: 'drop_view',
    name,
    ...(materialized === undefined ? {} : { materialized }),
  });
}

export function createSequenceDdl(definition: SequenceDef, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'create_sequence', definition });
}

export function generatedColumnDdl(definition: GeneratedColumn, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'generated_column', definition });
}

export function createSchemaDdl(name: string, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'create_schema', name });
}

export function qualify(schema: string, object: string, dialect: SqlDialect): string {
  return `${quoteId(dialect, schema)}.${quoteId(dialect, object)}`;
}

export function enableRlsDdl(table: string, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'enable_rls', table });
}

export function createPolicyDdl(definition: RlsPolicy, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'create_policy', definition });
}

export function createRoutineDdl(definition: RoutineDef, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'create_routine', definition });
}

export function dropRoutineDdl(definition: RoutineDef, dialect: SqlDialect): string {
  return exactlyOne(dialect, { kind: 'drop_routine', definition });
}

export function replaceRoutineStatements(
  previous: RoutineDef | undefined,
  next: RoutineDef,
  dialect: SqlDialect,
): readonly string[] {
  return dialect.migrations.emitSchemaObject({
    kind: 'replace_routine',
    ...(previous === undefined ? {} : { previous }),
    next,
  });
}

function normalizedRoutineBody(body: string): string {
  return body
    .split('\n')
    .map(line => line.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n+$/u, '');
}

export function routineFingerprint(definition: RoutineDef): string {
  return JSON.stringify([
    definition.kind,
    definition.name,
    definition.params.map(parameter => [parameter.name, parameter.type, parameter.mode ?? null]),
    definition.returns === undefined ? null : [definition.returns.type, definition.returns.setof ?? null],
    definition.language ?? null,
    definition.deterministic ?? null,
    normalizedRoutineBody(definition.body),
  ]);
}
