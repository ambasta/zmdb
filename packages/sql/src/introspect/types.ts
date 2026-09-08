import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from '../migrations/types.js';

export type ReferentialAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';

export type CatalogIndexColumn =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

export interface CatalogForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: ReferentialAction;
  readonly onUpdate: ReferentialAction;
}

export interface CatalogIndexSnapshot {
  readonly name: string;
  readonly columns: readonly CatalogIndexColumn[];
  readonly unique: boolean;
  readonly method?: string;
  readonly where?: string;
}

export interface CatalogColumnSnapshot extends ColumnSnapshot {
  readonly catalogType: string;
  readonly default?: string;
  /** Dialect catalog evidence for a generated column. Drift comparison may ignore it. */
  readonly generated?: {
    readonly expression: string;
    readonly stored: boolean;
  };
}

export interface CatalogWarning {
  readonly table: string;
  readonly column?: string;
  readonly reason: string;
}

export interface CatalogTableSnapshot extends Omit<TableSnapshot, 'columns'> {
  readonly columns: readonly CatalogColumnSnapshot[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly CatalogForeignKeySnapshot[];
  readonly indexes: readonly CatalogIndexSnapshot[];
}

export interface CatalogSchemaSnapshot extends Omit<SchemaSnapshot, 'tables'> {
  readonly tables: readonly CatalogTableSnapshot[];
  readonly extensions: readonly { readonly name: string; readonly schema?: string }[];
  readonly warnings: readonly CatalogWarning[];
}

export interface CatalogSelection {
  readonly schemas?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}
