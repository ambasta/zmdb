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

export function snapshot(_schemas: readonly unknown[]): SchemaSnapshot {
  throw new Error(NOT_IMPL);
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
