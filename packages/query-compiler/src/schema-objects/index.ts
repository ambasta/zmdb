import { UnsupportedFeatureError } from '../errors.js';
// Schema-object DDL emitters — see ./SPEC.md. Pure, dialect-aware.
import type { Dialect } from '../index.js';
import { quoteIdentifier } from '../quoting.js';

export { UnsupportedFeatureError };

export function quoteId(dialect: Dialect, id: string): string {
  return quoteIdentifier(dialect, id);
}

// §1 indexes & constraints
export interface IndexDef {
  name: string;
  table: string;
  columns: readonly string[];
  unique?: boolean;
  where?: string;
}
export function createIndexDdl(def: IndexDef, dialect: Dialect): string {
  const cols = def.columns.map(c => quoteId(dialect, c)).join(', ');
  const unique = def.unique ? 'UNIQUE ' : '';
  const where = def.where ? ` WHERE ${def.where}` : '';
  return `CREATE ${unique}INDEX ${quoteId(dialect, def.name)} ON ${quoteId(dialect, def.table)} (${cols})${where}`;
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
  if (def.materialized && dialect !== 'postgres') {
    throw new UnsupportedFeatureError('materialized views', dialect);
  }
  const mat = def.materialized ? 'MATERIALIZED ' : '';
  return `CREATE ${mat}VIEW ${quoteId(dialect, def.name)} AS ${def.select}`;
}
export function dropViewDdl(name: string, dialect: Dialect, materialized?: boolean): string {
  if (materialized && dialect !== 'postgres') {
    throw new UnsupportedFeatureError('materialized views', dialect);
  }
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
  let ddl = `CREATE SEQUENCE ${quoteId(dialect, def.name)}`;
  if (def.start !== undefined) ddl += ` START ${def.start}`;
  if (def.increment !== undefined) ddl += ` INCREMENT ${def.increment}`;
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
  const stored = col.stored ? ' STORED' : '';
  return `${quoteId(dialect, col.name)} ${col.type} GENERATED ALWAYS AS (${col.expression})${stored}`;
}

// §5 schemas / namespaces
export function createSchemaDdl(name: string, dialect: Dialect): string {
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
  if (dialect !== 'postgres') throw new UnsupportedFeatureError('row-level security', dialect);
  return `ALTER TABLE ${quoteId(dialect, table)} ENABLE ROW LEVEL SECURITY`;
}
export function createPolicyDdl(p: RlsPolicy, dialect: Dialect): string {
  if (dialect !== 'postgres') throw new UnsupportedFeatureError('row-level security', dialect);
  const cmd = p.command ?? 'ALL';
  return `CREATE POLICY ${quoteId(dialect, p.name)} ON ${quoteId(dialect, p.table)} FOR ${cmd} USING (${p.using})`;
}
