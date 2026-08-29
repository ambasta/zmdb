// Migrations — API stubs (red phase). Implementation in #41–#44.
import type { Dialect } from '../index.ts';

const NOT_IMPL = 'not implemented';

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

export function diff(_prev: SchemaSnapshot, _next: SchemaSnapshot): readonly ChangeOp[] {
  throw new Error(NOT_IMPL);
}

export function emitUp(_op: ChangeOp, _dialect: Dialect): string {
  throw new Error(NOT_IMPL);
}

export function emitDown(_op: ChangeOp, _dialect: Dialect): string {
  throw new Error(NOT_IMPL);
}
