export interface ExtensionType {
  readonly extension: string;
  readonly name: string;
  readonly args?: readonly (string | number)[];
}

export interface ColumnSnapshot {
  readonly name: string;
  /**
   * The **abstract** column type — `'timestamp'`, not `'TIMESTAMPTZ'`.
   *
   * A snapshot is a record of what the schema says, so it must not name a dialect: the
   * same snapshot is diffed and then emitted for Postgres, MySQL and SQLite. `ddlType`
   * is where it becomes a real one.
   */
  readonly type: string | ExtensionType;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  /** `varchar(255)` → `255`. MySQL rejects a `VARCHAR` with no length. */
  readonly length?: number | undefined;
  /** Carried so dialect-specific DDL can validate or emit the declaration. */
  readonly unique?: boolean;
}

export interface TableOptions {
  readonly shardKey?: readonly string[];
  readonly sortKey?: readonly string[];
  readonly rowstore?: true;
}

export type ReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

export interface ForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: ReferentialAction;
  readonly onUpdate: ReferentialAction;
}

export interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
  /** Ordered by declaration, independently of the deterministically sorted columns. */
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly ForeignKeySnapshot[];
  readonly tableOptions?: TableOptions;
}

export interface SchemaSnapshot {
  readonly version: 1;
  readonly tables: readonly TableSnapshot[];
  readonly extensions: readonly ExtensionSnapshot[];
}

export interface ExtensionSnapshot {
  readonly name: string;
  readonly schema?: string;
}

export type ChangeOp =
  | { readonly kind: 'create_extension'; readonly name: string; readonly schema?: string }
  | {
      readonly kind: 'create_table';
      readonly table: string;
      readonly columns: readonly ColumnSnapshot[];
      readonly primaryKey: readonly string[];
      readonly foreignKeys: readonly ForeignKeySnapshot[];
      readonly tableOptions?: TableOptions;
    }
  | { readonly kind: 'drop_table'; readonly table: string }
  | { readonly kind: 'add_column'; readonly table: string; readonly column: ColumnSnapshot }
  | { readonly kind: 'drop_column'; readonly table: string; readonly column: string }
  | {
      readonly kind: 'alter_column_type';
      readonly table: string;
      readonly column: string;
      readonly from: string | ExtensionType;
      readonly to: string | ExtensionType;
      /** Required by dialects whose ALTER COLUMN restates nullability. */
      readonly fromNullable?: boolean;
      /** Required by dialects whose ALTER COLUMN restates nullability. */
      readonly toNullable?: boolean;
    }
  | {
      readonly kind: 'alter_primary_key';
      readonly table: string;
      readonly from: readonly string[];
      readonly to: readonly string[];
    }
  | { readonly kind: 'add_foreign_key'; readonly table: string; readonly fk: ForeignKeySnapshot }
  | { readonly kind: 'drop_foreign_key'; readonly table: string; readonly name: string };
