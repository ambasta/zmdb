// Schema-object DDL emitters — see ./SPEC.md. Pure, dialect-aware.
import type { Dialect } from '../index.ts';

export class UnsupportedFeatureError extends Error {}

const Q: Record<Dialect, string> = { postgres: '"', mysql: '`', sqlite: '"' };
export function quoteId(dialect: Dialect, id: string): string {
  const q = Q[dialect];
  return `${q}${id}${q}`;
}

// §1 indexes & constraints
export interface IndexDef {
  name: string;
  table: string;
  columns: readonly string[];
  unique?: boolean;
  where?: string;
}
export function createIndexDdl(_def: IndexDef, _dialect: Dialect): string {
  throw new Error('not implemented');
}
export function checkConstraintDdl(_table: string, _name: string, _expr: string, _dialect: Dialect): string {
  throw new Error('not implemented');
}

// §2 views
export interface ViewDef {
  name: string;
  select: string;
  materialized?: boolean;
}
export function createViewDdl(_def: ViewDef, _dialect: Dialect): string {
  throw new Error('not implemented');
}
export function dropViewDdl(_name: string, _dialect: Dialect, _materialized?: boolean): string {
  throw new Error('not implemented');
}

// §3 sequences
export interface SequenceDef {
  name: string;
  start?: number;
  increment?: number;
}
export function createSequenceDdl(_def: SequenceDef, _dialect: Dialect): string {
  throw new Error('not implemented');
}

// §4 generated columns
export interface GeneratedColumn {
  name: string;
  type: string;
  expression: string;
  stored?: boolean;
}
export function generatedColumnDdl(_col: GeneratedColumn, _dialect: Dialect): string {
  throw new Error('not implemented');
}

// §5 schemas / namespaces
export function createSchemaDdl(_name: string, _dialect: Dialect): string {
  throw new Error('not implemented');
}
export function qualify(_schema: string, _object: string, _dialect: Dialect): string {
  throw new Error('not implemented');
}

// §6 RLS
export interface RlsPolicy {
  name: string;
  table: string;
  using: string;
  command?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
}
export function enableRlsDdl(_table: string, _dialect: Dialect): string {
  throw new Error('not implemented');
}
export function createPolicyDdl(_p: RlsPolicy, _dialect: Dialect): string {
  throw new Error('not implemented');
}
