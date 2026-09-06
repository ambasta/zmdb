import {
  builtInDialect,
  requireDialectFeature,
  TRAITS,
  type BuiltInDialect,
  type DialectSqlType,
  type DialectTypeMap,
  type MigrationDialect,
} from '../dialects/index.js';
import { UnsupportedFeatureError } from '../errors.js';
// Schema-object DDL emitters — see ./SPEC.md. Pure, dialect-aware.
import type { Dialect } from '../index.js';
import type { ColumnSnapshot, ExtensionType } from '../migrations/types.js';
import { quoteIdentifier } from '../quoting.js';
import type {
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

function isMigrationDialect(value: unknown): value is MigrationDialect {
  if (value === null || typeof value !== 'object') return false;
  return (
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'ddlType') === 'function' &&
    typeof Reflect.get(value, 'emitUp') === 'function' &&
    typeof Reflect.get(value, 'emitDown') === 'function'
  );
}

/** Backward-compatible view of the type maps owned by the resolved traits registry. */
export const DDL_TYPES: Readonly<Record<BuiltInDialect, DialectTypeMap>> = Object.freeze({
  postgres: TRAITS.postgres.types,
  mysql: TRAITS.mysql.types,
  sqlite: TRAITS.sqlite.types,
  cockroach: TRAITS.cockroach.types,
  singlestore: TRAITS.singlestore.types,
});

export type DdlSqlType = DialectSqlType;

function ddlScalarType(dialect: BuiltInDialect, type: string): string {
  const types: Readonly<Record<string, string>> = TRAITS[dialect].types;
  return types[type] ?? type;
}

const EXTENSION_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function extensionTypeDdl(type: ExtensionType): string {
  if (!EXTENSION_IDENTIFIER.test(type.name)) {
    throw new TypeError(`extension type name ${JSON.stringify(type.name)} is not a SQL identifier`);
  }
  const args = type.args ?? [];
  const rendered = args.map(argument => {
    if (typeof argument === 'number' && Number.isFinite(argument)) return String(argument);
    if (typeof argument === 'string' && EXTENSION_IDENTIFIER.test(argument)) return argument;
    throw new TypeError(
      `extension type ${type.name} argument ${JSON.stringify(argument)} must be a finite number or SQL identifier`,
    );
  });
  return `${type.name}${rendered.length === 0 ? '' : `(${rendered.join(',')})`}`;
}

function unsupportedExtensionType(
  dialect: BuiltInDialect,
  type: ExtensionType,
  column: string,
  table?: string,
): UnsupportedFeatureError {
  const rendered = extensionTypeDdl(type);
  const location = table === undefined ? `column "${column}"` : `"${table}"."${column}"`;
  return new UnsupportedFeatureError(
    `extension type ${rendered}`,
    dialect,
    `${dialect} does not support the extension type ${rendered} on ${location} (extension \`${type.extension}\`); ` +
      'there is no equivalent, and storing it as TEXT would produce a value the database cannot use',
  );
}

/**
 * The dialect's spelling of an abstract type or one column's complete type.
 *
 * Kept with runtime schema-object SQL so the hot-path package exposes only the
 * structural DDL primitive that the migrations package injects.
 */
export function ddlType(migrations: MigrationDialect, column: ColumnSnapshot): string;
export function ddlType(dialect: Dialect, type: string): string;
export function ddlType(dialect: Dialect, column: ColumnSnapshot): string;
export function ddlType(
  dialectOrMigrations: Dialect | MigrationDialect,
  typeOrColumn: string | ColumnSnapshot,
): string {
  if (isMigrationDialect(dialectOrMigrations)) {
    if (typeof typeOrColumn === 'string') {
      throw new TypeError('an injected migration dialect requires a complete ColumnSnapshot');
    }
    return dialectOrMigrations.ddlType(typeOrColumn);
  }
  const dialect = builtInDialect(dialectOrMigrations);
  const isColumn = typeof typeOrColumn !== 'string';
  const column = isColumn ? typeOrColumn : undefined;
  const type = isColumn ? typeOrColumn.type : typeOrColumn === 'serial' ? 'integer' : typeOrColumn;
  if (typeof type !== 'string') {
    if (dialect !== 'postgres') throw unsupportedExtensionType(dialect, type, column?.name ?? 'unknown');
    return extensionTypeDdl(type);
  }
  const mapped = ddlScalarType(dialect, type);

  if (type === 'varchar') {
    if (column?.length !== undefined && mapped === 'VARCHAR') {
      return `${mapped}(${column.length})`;
    }
    if (TRAITS[dialect].family === 'mysql') return 'TEXT';
    return mapped;
  }

  if (column?.type === 'serial') {
    return !column.primaryKey && mapped.endsWith('AUTO_INCREMENT') ? `${mapped} UNIQUE` : mapped;
  }

  return mapped;
}

export function quoteId(dialect: Dialect, id: string): string {
  return quoteIdentifier(dialect, id);
}

const INDEX_OPTIONS = {
  btree: [],
  hash: [],
  gin: [],
  gist: [],
  brin: [],
  ivfflat: ['lists'],
  hnsw: ['m', 'ef_construction'],
} as const satisfies Readonly<Record<IndexMethod, readonly string[]>>;

const INDEX_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isIndexMethod(value: string): value is IndexMethod {
  return Object.hasOwn(INDEX_OPTIONS, value);
}

function indexMethod(value: unknown, def: IndexDef): IndexMethod | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && isIndexMethod(value)) return value;
  throw new TypeError(`invalid index method ${JSON.stringify(value)} ("${def.name}")`);
}

function assertIndexMethodSupported(method: IndexMethod | undefined, def: IndexDef, dialect: Dialect): void {
  const family = TRAITS[builtInDialect(dialect)].family;
  if (dialect === 'postgres' && def.unique === true && method !== undefined && method !== 'btree') {
    throw new UnsupportedFeatureError(
      `unique ${method} index`,
      dialect,
      `postgres does not support a unique ${method} index ("${def.name}" on "${def.table}")`,
    );
  }
  if (method === undefined || dialect === 'postgres') return;
  if (family === 'mysql' && (method === 'btree' || method === 'hash')) return;
  throw new UnsupportedFeatureError(
    `index method ${method}`,
    dialect,
    `${dialect} does not support the index method ${method} ("${def.name}" on "${def.table}")`,
  );
}

function indexOptions(def: IndexDef, method: IndexMethod | undefined): string {
  const options = def.with;
  if (options === undefined || Object.keys(options).length === 0) return '';
  if (method === undefined) {
    throw new TypeError(`index options require a method ("${def.name}")`);
  }

  const allowed: readonly string[] = INDEX_OPTIONS[method];
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw new TypeError(
        `${method} does not take the option \`${key}\` ("${def.name}"); ` +
          `${method} options are (${allowed.join(', ')})`,
      );
    }
  }

  const rendered: string[] = [];
  for (const key of allowed) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`${method} option \`${key}\` must be a non-negative integer ("${def.name}")`);
    }
    rendered.push(`${key} = ${value}`);
  }
  return rendered.length === 0 ? '' : ` WITH (${rendered.join(', ')})`;
}

type StructuredIndexColumn = Exclude<IndexColumn, string>;
type ExpressionIndexColumn = Extract<StructuredIndexColumn, { readonly expr: string }>;

function isExpressionColumn(column: StructuredIndexColumn): column is ExpressionIndexColumn {
  return Object.hasOwn(column, 'expr');
}

function renderIndexColumn(column: IndexColumn, def: IndexDef, dialect: Dialect): string {
  if (typeof column === 'string') return quoteId(dialect, column);

  const expression = isExpressionColumn(column);
  if (expression && TRAITS[builtInDialect(dialect)].family === 'mysql') {
    const expr = column.expr;
    throw new UnsupportedFeatureError(
      `expression index "${def.name}"`,
      dialect,
      `${dialect} does not support an expression index ("${def.name}" on "${def.table}" uses ${expr}); ` +
        'add a generated column and index that instead',
    );
  }

  const value = expression ? column.expr : column.column;
  const rendered = expression ? value : quoteId(dialect, value);
  if (column.opclass === undefined) return rendered;
  if (dialect !== 'postgres') {
    throw new UnsupportedFeatureError(
      `index operator class ${column.opclass}`,
      dialect,
      `${dialect} does not support the index operator class ${column.opclass} ("${def.name}")`,
    );
  }
  if (!INDEX_IDENTIFIER.test(column.opclass)) {
    throw new TypeError(
      `index operator class ${JSON.stringify(column.opclass)} is not a SQL identifier ("${def.name}")`,
    );
  }
  return `${rendered} ${column.opclass}`;
}

export function createIndexDdl(def: IndexDef, dialect: Dialect): string {
  if (def.where !== undefined) {
    requireDialectFeature(dialect, 'partialIndex', 'partial indexes');
  }
  const method = indexMethod(def.method, def);
  assertIndexMethodSupported(method, def, dialect);
  if (dialect === 'singlestore' && method !== undefined) {
    throw new UnsupportedFeatureError(
      `index method ${method} without table-storage evidence`,
      dialect,
      `singlestore cannot emit explicit ${method.toUpperCase()} index "${def.name}" because method support depends ` +
        'on rowstore versus columnstore storage; omit the method or use a reviewed hand-written migration',
    );
  }
  const cols = def.columns.map(column => renderIndexColumn(column, def, dialect)).join(', ');
  const unique = def.unique ? 'UNIQUE ' : '';
  const mysqlMethod =
    TRAITS[builtInDialect(dialect)].family === 'mysql' && method !== undefined ? ` USING ${method.toUpperCase()}` : '';
  const postgresMethod = dialect === 'postgres' && method !== undefined ? ` USING ${method}` : '';
  const withOptions = indexOptions(def, method);
  const where = def.where ? ` WHERE ${def.where}` : '';
  return (
    `CREATE ${unique}INDEX ${quoteId(dialect, def.name)}${mysqlMethod} ON ${quoteId(dialect, def.table)}` +
    `${postgresMethod} (${cols})${withOptions}${where}`
  );
}
export function checkConstraintDdl(table: string, name: string, expr: string, dialect: Dialect): string {
  if (dialect === 'singlestore') {
    throw new UnsupportedFeatureError(
      `check constraint "${name}"`,
      dialect,
      `singlestore does not support CHECK constraint "${name}" on "${table}"`,
    );
  }
  return `ALTER TABLE ${quoteId(dialect, table)} ADD CONSTRAINT ${quoteId(dialect, name)} CHECK (${expr})`;
}

export function createViewDdl(def: ViewDef, dialect: Dialect): string {
  if (def.materialized) requireDialectFeature(dialect, 'materializedView', 'materialized views');
  const mat = def.materialized ? 'MATERIALIZED ' : '';
  return `CREATE ${mat}VIEW ${quoteId(dialect, def.name)} AS ${def.select}`;
}
export function dropViewDdl(name: string, dialect: Dialect, materialized?: boolean): string {
  if (materialized) requireDialectFeature(dialect, 'materializedView', 'materialized views');
  const mat = materialized ? 'MATERIALIZED ' : '';
  return `DROP ${mat}VIEW IF EXISTS ${quoteId(dialect, name)}`;
}

export function createSequenceDdl(def: SequenceDef, dialect: Dialect): string {
  requireDialectFeature(dialect, 'sequences', 'sequences');
  let ddl = `CREATE SEQUENCE ${quoteId(dialect, def.name)}`;
  if (def.start !== undefined) ddl += ` START ${def.start}`;
  if (def.increment !== undefined) ddl += ` INCREMENT ${def.increment}`;
  return ddl;
}

export function generatedColumnDdl(col: GeneratedColumn, dialect: Dialect): string {
  requireDialectFeature(dialect, 'generatedColumns', 'generated columns');
  const stored = col.stored ? ' STORED' : '';
  return `${quoteId(dialect, col.name)} ${col.type} GENERATED ALWAYS AS (${col.expression})${stored}`;
}

// §5 schemas / namespaces
export function createSchemaDdl(name: string, dialect: Dialect): string {
  requireDialectFeature(dialect, 'schemas', 'schemas');
  return `CREATE SCHEMA ${quoteId(dialect, name)}`;
}
export function qualify(schema: string, object: string, dialect: Dialect): string {
  return `${quoteId(dialect, schema)}.${quoteId(dialect, object)}`;
}

export function enableRlsDdl(table: string, dialect: Dialect): string {
  requireDialectFeature(dialect, 'rowLevelSecurity', 'row-level security');
  return `ALTER TABLE ${quoteId(dialect, table)} ENABLE ROW LEVEL SECURITY`;
}
export function createPolicyDdl(p: RlsPolicy, dialect: Dialect): string {
  requireDialectFeature(dialect, 'rowLevelSecurity', 'row-level security');
  const cmd = p.command ?? 'ALL';
  return `CREATE POLICY ${quoteId(dialect, p.name)} ON ${quoteId(dialect, p.table)} FOR ${cmd} USING (${p.using})`;
}

function routineLabel(def: RoutineDef, dialect: Dialect): string {
  return `${def.kind} ${quoteId(dialect, def.name)}`;
}

function unsupportedRoutine(feature: string, dialect: Dialect): UnsupportedFeatureError {
  return new UnsupportedFeatureError(feature, dialect);
}

function assertRoutineSupported(def: RoutineDef, dialect: Dialect): void {
  if (dialect === 'sqlite' || dialect === 'singlestore') {
    if (dialect === 'singlestore') {
      throw unsupportedRoutine(
        `singlestore stored routines are not modeled (${routineLabel(def, dialect)}); SingleStore uses ` +
          'different CREATE FUNCTION and CREATE PROCEDURE grammar, so use a hand-written migration',
        dialect,
      );
    }
    throw unsupportedRoutine(
      `sqlite does not support stored routines (${routineLabel(def, dialect)}); SQLite has no CREATE FUNCTION, ` +
        'so register the function on the connection instead — `node:sqlite` exposes `DatabaseSync#function` — ' +
        'and call it like any other',
      dialect,
    );
  }

  for (const param of def.params) {
    if (param.mode === 'out' || param.mode === 'inout') {
      throw unsupportedRoutine(
        `${dialect} routine ${routineLabel(def, dialect)} has unsupported ${param.mode} parameter ${quoteId(dialect, param.name)}`,
        dialect,
      );
    }
  }
}

function routineTypeDdl(dialect: Dialect, type: RoutineSqlType | 'void'): string {
  if (type === 'void') return 'VOID';
  return ddlType(dialect, type);
}

function routineParamsDdl(def: RoutineDef, dialect: Dialect): string {
  return def.params.map(param => `${quoteId(dialect, param.name)} ${routineTypeDdl(dialect, param.type)}`).join(', ');
}

function routineReturns(def: RoutineDef, dialect: Dialect): string {
  if (def.kind === 'procedure') {
    if (def.returns !== undefined) {
      throw new TypeError(`${routineLabel(def, dialect)} cannot declare a return type`);
    }
    return '';
  }
  if (def.returns === undefined) {
    throw new TypeError(`${routineLabel(def, dialect)} must declare a return type`);
  }
  if (
    TRAITS[builtInDialect(dialect)].family === 'mysql' &&
    (def.returns.setof === true || def.returns.type === 'void')
  ) {
    throw unsupportedRoutine(
      `mysql routine ${routineLabel(def, dialect)} cannot return ${def.returns.setof === true ? 'a set' : 'void'}`,
      dialect,
    );
  }
  const setof = def.returns.setof === true ? 'SETOF ' : '';
  return ` RETURNS ${setof}${routineTypeDdl(dialect, def.returns.type)}`;
}

function dollarQuoteTag(body: string): string {
  for (let suffix = 0; ; suffix++) {
    const tag = suffix === 0 ? '$zmdb$' : `$zmdb${suffix}$`;
    if (!body.includes(tag)) return tag;
  }
}

export function createRoutineDdl(def: RoutineDef, dialect: Dialect): string {
  assertRoutineSupported(def, dialect);
  const kind = def.kind.toUpperCase();
  const head = `${kind} ${quoteId(dialect, def.name)}(${routineParamsDdl(def, dialect)})`;
  const returns = routineReturns(def, dialect);

  if (TRAITS[builtInDialect(dialect)].family === 'postgres') {
    const language = def.language ?? 'plpgsql';
    const tag = dollarQuoteTag(def.body);
    return `CREATE OR REPLACE ${head}${returns} LANGUAGE ${language} AS ${tag}\n${def.body}\n${tag}`;
  }

  if (def.language !== undefined) {
    throw unsupportedRoutine(
      `mysql routine ${routineLabel(def, dialect)} cannot declare language ${JSON.stringify(def.language)}`,
      dialect,
    );
  }
  const deterministic =
    def.kind === 'function' ? ` ${def.deterministic === true ? 'DETERMINISTIC' : 'NOT DETERMINISTIC'}` : '';
  return `CREATE ${head}${returns}${deterministic} MODIFIES SQL DATA SQL SECURITY INVOKER\n${def.body}`;
}

export function dropRoutineDdl(def: RoutineDef, dialect: Dialect): string {
  assertRoutineSupported(def, dialect);
  const kind = def.kind.toUpperCase();
  const name = quoteId(dialect, def.name);
  if (TRAITS[builtInDialect(dialect)].family === 'mysql') return `DROP ${kind} IF EXISTS ${name}`;
  const signature = def.params.map(param => routineTypeDdl(dialect, param.type)).join(', ');
  return `DROP ${kind} IF EXISTS ${name}(${signature})`;
}

function samePostgresSignature(previous: RoutineDef, next: RoutineDef): boolean {
  if (previous.kind !== next.kind || previous.name !== next.name || previous.params.length !== next.params.length) {
    return false;
  }
  if (previous.params.some((param, index) => param.type !== next.params[index]?.type)) return false;
  if (previous.kind === 'procedure') return true;
  return previous.returns?.type === next.returns?.type && previous.returns?.setof === next.returns?.setof;
}

export function replaceRoutineStatements(
  previous: RoutineDef | undefined,
  next: RoutineDef,
  dialect: Dialect,
): readonly string[] {
  const create = createRoutineDdl(next, dialect);
  if (
    TRAITS[builtInDialect(dialect)].family === 'postgres' &&
    (previous === undefined || samePostgresSignature(previous, next))
  ) {
    return [create];
  }
  return [dropRoutineDdl(previous ?? next, dialect), create];
}

function normalizedRoutineBody(body: string): string {
  return body
    .split('\n')
    .map(line => line.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n+$/u, '');
}

export function routineFingerprint(def: RoutineDef): string {
  return JSON.stringify([
    def.kind,
    def.name,
    def.params.map(param => [param.name, param.type, param.mode ?? null]),
    def.returns === undefined ? null : [def.returns.type, def.returns.setof ?? null],
    def.language ?? null,
    def.deterministic ?? null,
    normalizedRoutineBody(def.body),
  ]);
}
