import { requireDialectFeature } from '../dialects/index.js';
import { UnsupportedFeatureError } from '../errors.js';
// Schema-object DDL emitters — see ./SPEC.md. Pure, dialect-aware.
import type { Dialect } from '../index.js';
import { ddlType } from '../migrations/index.js';
import { quoteIdentifier } from '../quoting.js';

export { UnsupportedFeatureError };
export { createExtensionDdl, type ExtensionDef } from './extensions.js';

export function quoteId(dialect: Dialect, id: string): string {
  return quoteIdentifier(dialect, id);
}

// §1 indexes & constraints
export type IndexMethod = 'btree' | 'hash' | 'gin' | 'gist' | 'brin' | 'ivfflat' | 'hnsw';
export type IndexColumn =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

export interface IndexDef {
  name: string;
  table: string;
  columns: readonly IndexColumn[];
  unique?: boolean;
  where?: string;
  method?: IndexMethod;
  with?: Readonly<Record<string, number>>;
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
  if (dialect === 'postgres' && def.unique === true && method !== undefined && method !== 'btree') {
    throw new UnsupportedFeatureError(
      `unique ${method} index`,
      dialect,
      `postgres does not support a unique ${method} index ("${def.name}" on "${def.table}")`,
    );
  }
  if (method === undefined || dialect === 'postgres') return;
  if (dialect === 'mysql' && (method === 'btree' || method === 'hash')) return;
  if (dialect === 'mssql' && method === 'btree') return;
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
  if (expression && (dialect === 'mysql' || dialect === 'mssql')) {
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
  const cols = def.columns.map(column => renderIndexColumn(column, def, dialect)).join(', ');
  const unique = def.unique ? 'UNIQUE ' : '';
  const mysqlMethod = dialect === 'mysql' && method !== undefined ? ` USING ${method.toUpperCase()}` : '';
  const postgresMethod = dialect === 'postgres' && method !== undefined ? ` USING ${method}` : '';
  const withOptions = indexOptions(def, method);
  const where = def.where ? ` WHERE ${def.where}` : '';
  return (
    `CREATE ${unique}INDEX ${quoteId(dialect, def.name)}${mysqlMethod} ON ${quoteId(dialect, def.table)}` +
    `${postgresMethod} (${cols})${withOptions}${where}`
  );
}
export function checkConstraintDdl(table: string, name: string, expr: string, dialect: Dialect): string {
  return `ALTER TABLE ${quoteId(dialect, table)} ADD CONSTRAINT ${quoteId(dialect, name)} CHECK (${expr})`;
}

// §2 views
export interface ViewDef {
  name: string;
  select: string;
  materialized?: boolean;
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

// §3 sequences
export interface SequenceDef {
  name: string;
  start?: number;
  increment?: number;
}
export function createSequenceDdl(def: SequenceDef, dialect: Dialect): string {
  requireDialectFeature(dialect, 'sequences', 'sequences');
  let ddl = `CREATE SEQUENCE ${quoteId(dialect, def.name)}`;
  if (def.start !== undefined) ddl += dialect === 'mssql' ? ` START WITH ${def.start}` : ` START ${def.start}`;
  if (def.increment !== undefined) {
    ddl += dialect === 'mssql' ? ` INCREMENT BY ${def.increment}` : ` INCREMENT ${def.increment}`;
  }
  return ddl;
}

// §4 generated columns
export interface GeneratedColumn {
  name: string;
  type: string;
  expression: string;
  stored?: boolean;
}
export function generatedColumnDdl(col: GeneratedColumn, dialect: Dialect): string {
  requireDialectFeature(dialect, 'generatedColumns', 'generated columns');
  if (dialect === 'mssql') {
    return `${quoteId(dialect, col.name)} AS (${col.expression})${col.stored ? ' PERSISTED' : ''}`;
  }
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

// §6 RLS
export interface RlsPolicy {
  name: string;
  table: string;
  using: string;
  command?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
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

// §8 stored routines
export type RoutineSqlType =
  | 'serial'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'text'
  | 'varchar'
  | 'boolean'
  | 'timestamp'
  | 'json'
  | 'jsonEnum';

export interface RoutineDef {
  readonly kind: 'function' | 'procedure';
  readonly name: string;
  readonly params: readonly {
    readonly name: string;
    readonly type: RoutineSqlType;
    readonly mode?: 'in' | 'out' | 'inout';
  }[];
  readonly returns?: { readonly type: RoutineSqlType | 'void'; readonly setof?: boolean };
  readonly language?: string;
  readonly deterministic?: boolean;
  readonly body: string;
}

function routineLabel(def: RoutineDef, dialect: Dialect): string {
  return `${def.kind} ${quoteId(dialect, def.name)}`;
}

function unsupportedRoutine(feature: string, dialect: Dialect): UnsupportedFeatureError {
  return new UnsupportedFeatureError(feature, dialect);
}

function assertRoutineSupported(def: RoutineDef, dialect: Dialect): void {
  if (dialect === 'sqlite' || dialect === 'mssql') {
    if (dialect === 'mssql') {
      throw unsupportedRoutine(
        `mssql stored routines are not modeled (${routineLabel(def, dialect)}); SQL Server uses a distinct ` +
          'CREATE/ALTER and EXEC grammar, so use a hand-written migration and driver call',
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
  if (dialect === 'mysql' && (def.returns.setof === true || def.returns.type === 'void')) {
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

  if (dialect === 'postgres') {
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
  if (dialect === 'mysql') return `DROP ${kind} IF EXISTS ${name}`;
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
  if (dialect === 'postgres' && (previous === undefined || samePostgresSignature(previous, next))) {
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
