// Migrations — API stubs (red phase). Implementation in #41–#44.
import type { Dialect } from '../index.ts';


export interface ColumnSnapshot {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
}

export interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
}

export interface SchemaSnapshot {
  readonly version: 1;
  readonly tables: readonly TableSnapshot[];
}

export type ChangeOp =
  | { readonly kind: 'create_table'; readonly table: string; readonly columns: readonly ColumnSnapshot[] }
  | { readonly kind: 'drop_table'; readonly table: string }
  | { readonly kind: 'add_column'; readonly table: string; readonly column: ColumnSnapshot }
  | { readonly kind: 'drop_column'; readonly table: string; readonly column: string }
  | {
      readonly kind: 'alter_column_type';
      readonly table: string;
      readonly column: string;
      readonly from: string;
      readonly to: string;
    };

export function snapshot(schemas: readonly unknown[]): SchemaSnapshot {
  const tables: TableSnapshot[] = schemas
    .map((s) => {
      const schema = s as {
        table: string;
        columns: Record<string, { type: string; flags: { nullable: boolean; primaryKey?: boolean } }>;
      };
      const columns: ColumnSnapshot[] = Object.entries(schema.columns)
        .map(([name, meta]) => ({
          name,
          type: meta.type,
          nullable: meta.flags.nullable,
          primaryKey: meta.flags.primaryKey === true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { name: schema.table, columns };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { version: 1, tables };
}

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot): readonly ChangeOp[] {
  const ops: ChangeOp[] = [];
  const prevTables = new Map(prev.tables.map((t) => [t.name, t]));
  const nextTables = new Map(next.tables.map((t) => [t.name, t]));

  // Dropped tables.
  for (const t of prev.tables) {
    if (!nextTables.has(t.name)) ops.push({ kind: 'drop_table', table: t.name });
  }
  // Created tables + column-level diffs.
  for (const t of next.tables) {
    const before = prevTables.get(t.name);
    if (!before) {
      ops.push({ kind: 'create_table', table: t.name, columns: t.columns });
      continue;
    }
    const beforeCols = new Map(before.columns.map((c) => [c.name, c]));
    const afterCols = new Map(t.columns.map((c) => [c.name, c]));
    for (const c of before.columns) {
      if (!afterCols.has(c.name)) ops.push({ kind: 'drop_column', table: t.name, column: c.name });
    }
    for (const c of t.columns) {
      const bc = beforeCols.get(c.name);
      if (!bc) {
        ops.push({ kind: 'add_column', table: t.name, column: c });
      } else if (bc.type !== c.type) {
        ops.push({ kind: 'alter_column_type', table: t.name, column: c.name, from: bc.type, to: c.type });
      }
    }
  }
  return ops;
}

function columnDdl(d: Dialect, col: ColumnSnapshot): string {
  const q = d === 'mysql' ? '`' : '"';
  const nn = col.nullable ? '' : ' NOT NULL';
  const pk = col.primaryKey ? ' PRIMARY KEY' : '';
  return `${q}${col.name}${q} ${col.type}${pk}${nn}`;
}

function quote(d: Dialect, ident: string): string {
  const q = d === 'mysql' ? '`' : '"';
  return `${q}${ident}${q}`;
}

export function emitUp(op: ChangeOp, dialect: Dialect): string {
  switch (op.kind) {
    case 'create_table':
      return `CREATE TABLE ${quote(dialect, op.table)} (${op.columns.map((c) => columnDdl(dialect, c)).join(', ')})`;
    case 'drop_table':
      return `DROP TABLE ${quote(dialect, op.table)}`;
    case 'add_column':
      return `ALTER TABLE ${quote(dialect, op.table)} ADD COLUMN ${columnDdl(dialect, op.column)}`;
    case 'drop_column':
      return `ALTER TABLE ${quote(dialect, op.table)} DROP COLUMN ${quote(dialect, op.column)}`;
    case 'alter_column_type':
      return `ALTER TABLE ${quote(dialect, op.table)} ALTER COLUMN ${quote(dialect, op.column)} TYPE ${op.to}`;
  }
}

export function emitDown(op: ChangeOp, dialect: Dialect): string {
  switch (op.kind) {
    case 'create_table':
      return `DROP TABLE ${quote(dialect, op.table)}`;
    case 'drop_table':
      return `CREATE TABLE ${quote(dialect, op.table)} ()`;
    case 'add_column':
      return `ALTER TABLE ${quote(dialect, op.table)} DROP COLUMN ${quote(dialect, op.column.name)}`;
    case 'drop_column':
      return `ALTER TABLE ${quote(dialect, op.table)} ADD COLUMN ${quote(dialect, op.column)}`;
    case 'alter_column_type':
      return `ALTER TABLE ${quote(dialect, op.table)} ALTER COLUMN ${quote(dialect, op.column)} TYPE ${op.from}`;
  }
}
