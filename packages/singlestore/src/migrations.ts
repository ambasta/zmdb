import type { ChangeOp, ColumnSnapshot, SchemaSnapshot, TableOptions } from '@zmdb/migrations';
import { mysql, mysqlFamilyMigrations, type MysqlTableDdlHelpers } from '@zmdb/mysql';
import {
  UnsupportedFeatureError,
  quoteIdentifier,
  type MigrationConnection,
  type MigrationDialect,
  type MigrationDriver,
  type MigrationPlan,
  type MigrationTableOptions,
  type SchemaObjectOperation,
} from '@zmdb/query-compiler';

export const SINGLESTORE_TYPE_OVERRIDES = Object.freeze({
  serial: 'BIGINT AUTO_INCREMENT',
  timestamp: 'DATETIME(6)',
});

type CreateTableOperation = Extract<ChangeOp, { readonly kind: 'create_table' }>;

interface TableShape {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly unknown[];
  readonly tableOptions?: TableOptions;
}

function unsupported(feature: string, message: string): never {
  throw new UnsupportedFeatureError(feature, 'singlestore', message);
}

function columnsExist(
  table: TableShape,
  label: 'shard key' | 'sort key',
  columns: readonly string[] | undefined,
): void {
  if (columns === undefined) return;
  if (columns.length === 0) throw new TypeError(`${label} on "${table.name}" must name at least one column`);
  if (new Set(columns).size !== columns.length) {
    throw new TypeError(`${label} on "${table.name}" must not repeat a column`);
  }
  const available = new Set(table.columns.map(column => column.name));
  for (const column of columns) {
    if (!available.has(column)) {
      throw new TypeError(`${label} on "${table.name}" names unknown column "${column}"`);
    }
  }
}

function includesShardKey(key: readonly string[], shardKey: readonly string[]): boolean {
  const columns = new Set(key);
  return shardKey.every(column => columns.has(column));
}

function validateUniqueKeys(table: TableShape, shardKey: readonly string[] | undefined): void {
  if (shardKey !== undefined && table.primaryKey.length > 0 && !includesShardKey(table.primaryKey, shardKey)) {
    unsupported(
      `primary key outside the shard key on "${table.name}"`,
      `singlestore cannot enforce the primary key on "${table.name}" unless it includes the whole shard key ` +
        `(${shardKey.join(', ')}); change the key or storage declaration before execution`,
    );
  }
  for (const column of table.columns) {
    const inlinePrimary = table.primaryKey.length === 1 && table.primaryKey[0] === column.name;
    const standaloneUnique = column.unique === true && column.type !== 'serial' && !inlinePrimary;
    const unkeyedSerial = column.type === 'serial' && !column.primaryKey;
    if (!standaloneUnique && !unkeyedSerial) continue;
    if (shardKey !== undefined && includesShardKey([column.name], shardKey)) continue;
    unsupported(
      `unique column "${column.name}" outside the shard key`,
      `singlestore cannot enforce UNIQUE on "${table.name}"."${column.name}" unless that index includes the ` +
        `whole shard key (${shardKey?.join(', ') ?? 'none declared'}); change the shard key or enforce uniqueness ` +
        'in the application',
    );
  }
}

function validateTable(table: TableShape): void {
  if (table.foreignKeys.length > 0) {
    unsupported(
      'foreign keys',
      `@zmdb/singlestore does not qualify foreign-key DDL; remove the ${
        table.foreignKeys.length === 1 ? 'constraint' : 'constraints'
      } from "${table.name}" before execution`,
    );
  }
  const options = table.tableOptions;
  const shardKey = options?.shardKey;
  const sortKey = options?.sortKey;
  if (shardKey === undefined && options?.rowstore !== true) {
    unsupported(
      'table options',
      `singlestore table "${table.name}" must declare ShardKey<…> or Rowstore; ` +
        'leaving both absent makes storage and distribution an accidental default',
    );
  }
  if (options?.rowstore === true && sortKey !== undefined) {
    unsupported(
      `sort key on rowstore table "${table.name}"`,
      `singlestore cannot declare SORT KEY on explicit ROWSTORE table "${table.name}"; ` +
        'use an ordinary rowstore index or remove Rowstore to create a columnstore table',
    );
  }
  columnsExist(table, 'shard key', shardKey);
  columnsExist(table, 'sort key', sortKey);
  validateUniqueKeys(table, shardKey);
}

function tableShape(operation: CreateTableOperation): TableShape {
  return {
    name: operation.table,
    columns: operation.columns,
    primaryKey: operation.primaryKey,
    foreignKeys: operation.foreignKeys,
    ...(operation.tableOptions === undefined ? {} : { tableOptions: operation.tableOptions }),
  };
}

const parent = mysqlFamilyMigrations('singlestore', {
  types: SINGLESTORE_TYPE_OVERRIDES,
  ledger: {
    createPrefix: 'CREATE ROWSTORE TABLE',
    definitions: ['SHARD KEY (`version`)'],
  },
  table: {
    createPrefix(operation): string {
      return operation.tableOptions?.rowstore === true ? 'CREATE ROWSTORE TABLE' : 'CREATE TABLE';
    },
    definitions(operation, helpers: MysqlTableDdlHelpers): readonly string[] {
      const options = operation.tableOptions;
      const definitions: string[] = [];
      if (options?.shardKey !== undefined) {
        definitions.push(`SHARD KEY (${helpers.keyColumns(options.shardKey)})`);
      }
      if (options?.sortKey !== undefined) {
        definitions.push(`SORT KEY (${helpers.keyColumns(options.sortKey)})`);
      }
      return definitions;
    },
  },
});

function validateSnapshot(snapshot: SchemaSnapshot): void {
  for (const table of snapshot.tables) validateTable(table);
}

function validateOperation(operation: ChangeOp): void {
  switch (operation.kind) {
    case 'create_table':
      validateTable(tableShape(operation));
      return;
    case 'add_foreign_key':
    case 'drop_foreign_key':
      unsupported(
        'foreign keys',
        `@zmdb/singlestore refuses foreign-key operation "${operation.kind}" on "${operation.table}" before execution`,
      );
    case 'add_column':
      if (operation.column.unique === true || operation.column.type === 'serial') {
        unsupported(
          `unique column "${operation.column.name}" without shard-key evidence`,
          `singlestore cannot add unique column "${operation.table}"."${operation.column.name}" because the ` +
            'operation does not carry the table shard key',
        );
      }
      return;
    case 'alter_primary_key':
      unsupported(
        `altering the primary key of "${operation.table}"`,
        `singlestore cannot alter the primary key of "${operation.table}" without proving its shard-key compatibility`,
      );
    default:
      return;
  }
}

function validateSchemaObject(operation: SchemaObjectOperation): void {
  switch (operation.kind) {
    case 'create_routine':
    case 'drop_routine':
    case 'replace_routine':
      unsupported(
        'stored routine DDL',
        'singlestore routine declarations do not share MySQL grammar; use a reviewed hand-written migration',
      );
    case 'create_index':
      if (operation.definition.unique === true) {
        unsupported(
          `unique index "${operation.definition.name}" without shard-key evidence`,
          `singlestore cannot emit unique index "${operation.definition.name}" because the operation does not carry ` +
            'the table shard key',
        );
      }
      if (operation.definition.method !== undefined) {
        unsupported(
          `index method ${operation.definition.method} without table-storage evidence`,
          `singlestore cannot emit explicit ${operation.definition.method.toUpperCase()} index ` +
            `"${operation.definition.name}" because method support depends on rowstore versus columnstore storage; ` +
            'omit the method or use a reviewed hand-written migration',
        );
      }
      return;
    case 'check_constraint':
      unsupported(
        `check constraint "${operation.name}"`,
        `singlestore does not support CHECK constraint "${operation.name}" on "${operation.table}"`,
      );
    default:
      return;
  }
}

function generatedColumn(operation: Extract<SchemaObjectOperation, { readonly kind: 'generated_column' }>): string {
  const definition = operation.definition;
  return (
    `${quoteIdentifier(mysql, definition.name)} AS (${definition.expression})` +
    `${definition.stored === true ? ' PERSISTED' : ''} ${definition.type}`
  );
}

export const singlestoreMigrations: MigrationDialect<'singlestore'> = Object.freeze({
  name: 'singlestore',
  validateSnapshot(snapshot: SchemaSnapshot): void {
    validateSnapshot(snapshot);
    parent.validateSnapshot(snapshot);
  },
  validatePlan(plan: MigrationPlan): void {
    validateSnapshot(plan.before);
    validateSnapshot(plan.after);
    for (const operation of plan.operations) validateOperation(operation);
    parent.validatePlan(plan);
  },
  ddlType(column: ColumnSnapshot): string {
    return parent.ddlType(column);
  },
  emitUp(operation: ChangeOp): string {
    validateOperation(operation);
    return parent.emitUp(operation);
  },
  emitDown(operation: ChangeOp): string {
    if (operation.kind === 'add_foreign_key' || operation.kind === 'drop_foreign_key') validateOperation(operation);
    return parent.emitDown(operation);
  },
  emitSchemaObject(operation: SchemaObjectOperation): readonly string[] {
    validateSchemaObject(operation);
    return operation.kind === 'generated_column' ? [generatedColumn(operation)] : parent.emitSchemaObject(operation);
  },
  connection(
    driver: MigrationDriver<'singlestore'>,
    options?: MigrationTableOptions,
  ): MigrationConnection<'singlestore'> {
    return parent.connection(driver, options);
  },
});
