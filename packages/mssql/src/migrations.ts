import type { ChangeOp, ColumnSnapshot, ForeignKeySnapshot, SchemaSnapshot } from '@zmdb/migrations';
import {
  quoteIdentifier,
  quoteTable,
  UnsupportedFeatureError,
  type AppliedMigration,
  type MigrationConnection,
  type MigrationDialect,
  type MigrationDriver,
  type MigrationPlan,
  type MigrationTableOptions,
  type SchemaObjectOperation,
} from '@zmdb/query-compiler';
import type { GeneratedColumn, IndexColumn, IndexDef, SequenceDef } from '@zmdb/query-compiler/schema-objects';

import { mssqlDdlType } from './types.js';

function identifier(name: string): string {
  return `[${name.replaceAll(']', ']]')}]`;
}

function table(name: string): string {
  return name
    .split('.')
    .map(part => identifier(part))
    .join('.');
}

function safeVersion(value: unknown, row: number): number {
  if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') {
    throw new TypeError(`SQL Server migration ledger row ${String(row)} has an invalid version`);
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version)) {
    throw new TypeError(`SQL Server migration ledger row ${String(row)} version is not a safe integer`);
  }
  return version;
}

function appliedMigration(row: Readonly<Record<string, unknown>>, index: number): AppliedMigration {
  const name = Reflect.get(row, 'name');
  const migrationChecksum = Reflect.get(row, 'checksum');
  if (typeof name !== 'string' || (migrationChecksum !== null && typeof migrationChecksum !== 'string')) {
    throw new TypeError(`SQL Server migration ledger row ${String(index)} has an invalid name or checksum`);
  }
  return {
    version: safeVersion(Reflect.get(row, 'version'), index),
    name,
    checksum: migrationChecksum,
  };
}

async function checksum(sql: string): Promise<string> {
  const bytes = new TextEncoder().encode(sql);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function migrationConnection(
  driver: MigrationDriver<'mssql'>,
  options: MigrationTableOptions = {},
): MigrationConnection<'mssql'> {
  const dialect = driver.dialect;
  const tableName = options.table ?? '_zmdb_migrations';
  const qualifiedTable = options.schema === undefined ? tableName : `${options.schema}.${tableName}`;
  const ledgerTable = quoteTable(dialect, qualifiedTable);

  async function execute(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly Record<string, unknown>[]> {
    return driver.execute({ text, parameters });
  }

  async function appliedMigrations(): Promise<readonly AppliedMigration[]> {
    const rows = await execute(`SELECT version, name, checksum FROM ${ledgerTable} ORDER BY version`);
    return rows.map(appliedMigration);
  }

  return {
    name: 'mssql',
    dialect,
    transactionalDdl: true,
    async exec(sql): Promise<void> {
      await execute(sql);
    },
    async appliedVersions(): Promise<readonly number[]> {
      return (await appliedMigrations()).map(migration => migration.version);
    },
    appliedMigrations,
    async recordApplied(version, name, migrationChecksum = ''): Promise<void> {
      await execute(
        `INSERT INTO ${ledgerTable} (` +
          `${quoteIdentifier(dialect, 'version')}, ${quoteIdentifier(dialect, 'name')}, ` +
          `${quoteIdentifier(dialect, 'applied_at')}, ${quoteIdentifier(dialect, 'checksum')}) ` +
          'VALUES (@p1, @p2, @p3, @p4)',
        [version, name, Date.now(), migrationChecksum],
      );
    },
    async recordReverted(version): Promise<void> {
      await execute(`DELETE FROM ${ledgerTable} WHERE ${quoteIdentifier(dialect, 'version')} = @p1`, [version]);
    },
    async ensureVersionTable(): Promise<void> {
      const objectName = qualifiedTable.replaceAll("'", "''");
      await execute(
        `IF OBJECT_ID(N'${objectName}', N'U') IS NULL ` +
          `CREATE TABLE ${ledgerTable} (` +
          `${quoteIdentifier(dialect, 'version')} BIGINT PRIMARY KEY, ` +
          `${quoteIdentifier(dialect, 'name')} NVARCHAR(MAX) NOT NULL, ` +
          `${quoteIdentifier(dialect, 'applied_at')} BIGINT NOT NULL, ` +
          `${quoteIdentifier(dialect, 'checksum')} NVARCHAR(MAX))`,
      );
      try {
        await execute(`SELECT ${quoteIdentifier(dialect, 'checksum')} FROM ${ledgerTable} WHERE 1 = 0`);
      } catch {
        await execute(`ALTER TABLE ${ledgerTable} ADD ${quoteIdentifier(dialect, 'checksum')} NVARCHAR(MAX)`);
      }
    },
    checksum,
    async transaction<Result>(run: (connection?: MigrationConnection<'mssql'>) => Promise<Result>): Promise<Result> {
      if (driver.transaction === undefined) {
        throw new Error(
          'mssql migrations require a transactional driver; every callback request must come from one node-mssql transaction',
        );
      }
      return driver.transaction(transactionDriver => run(migrationConnection(transactionDriver, options)));
    },
  };
}

function columnDdl(
  column: ColumnSnapshot,
  options: { readonly inlinePrimaryKey: boolean; readonly tablePrimaryKey: boolean },
): string {
  const primaryKey = options.inlinePrimaryKey ? ' PRIMARY KEY' : '';
  const notNull = !options.inlinePrimaryKey && (!column.nullable || options.tablePrimaryKey) ? ' NOT NULL' : '';
  return `${identifier(column.name)} ${mssqlDdlType(column)}${primaryKey}${notNull}`;
}

function action(actionName: ForeignKeySnapshot['onDelete']): string {
  return actionName === 'restrict' || actionName === 'no action' ? 'NO ACTION' : actionName.toUpperCase();
}

function foreignKeyDdl(foreignKey: ForeignKeySnapshot): string {
  const columns = foreignKey.columns.map(identifier).join(', ');
  const targetColumns = foreignKey.targetColumns.map(identifier).join(', ');
  return (
    `FOREIGN KEY (${columns}) REFERENCES ${table(foreignKey.targetTable)} (${targetColumns}) ` +
    `ON DELETE ${action(foreignKey.onDelete)} ON UPDATE ${action(foreignKey.onUpdate)}`
  );
}

function createTable(operation: Extract<ChangeOp, { readonly kind: 'create_table' }>): string {
  const inline = operation.primaryKey.length === 1 ? operation.primaryKey[0] : undefined;
  const composite = operation.primaryKey.length > 1 ? new Set(operation.primaryKey) : undefined;
  const definitions = operation.columns.map(column =>
    columnDdl(column, {
      inlinePrimaryKey: column.name === inline,
      tablePrimaryKey: composite?.has(column.name) === true,
    }),
  );
  if (composite !== undefined) {
    definitions.push(`PRIMARY KEY (${operation.primaryKey.map(identifier).join(', ')})`);
  }
  return `CREATE TABLE ${table(operation.table)} (${definitions.join(', ')})`;
}

function alterNullability(
  operation: Extract<ChangeOp, { readonly kind: 'alter_column_type' }>,
  direction: 'up' | 'down',
): string {
  const nullable = direction === 'up' ? operation.toNullable : operation.fromNullable;
  if (nullable === undefined) {
    throw new UnsupportedFeatureError(
      `altering the type of "${operation.table}"."${operation.column}" without nullability metadata`,
      'mssql',
      'mssql ALTER COLUMN must restate NULL or NOT NULL; generate this operation from snapshots or provide ' +
        `${direction === 'up' ? 'toNullable' : 'fromNullable'} explicitly`,
    );
  }
  return nullable ? ' NULL' : ' NOT NULL';
}

function alteredType(
  operation: Extract<ChangeOp, { readonly kind: 'alter_column_type' }>,
  direction: 'up' | 'down',
): string {
  return mssqlDdlType({
    name: operation.column,
    type: direction === 'up' ? operation.to : operation.from,
    nullable: direction === 'up' ? (operation.toNullable ?? true) : (operation.fromNullable ?? true),
    primaryKey: false,
  });
}

function primaryKeyRefusal(operation: Extract<ChangeOp, { readonly kind: 'alter_primary_key' }>): never {
  throw new UnsupportedFeatureError(
    `altering the primary key of "${operation.table}"`,
    'mssql',
    `mssql cannot safely alter the primary key of "${operation.table}" ` +
      `(${operation.from.join(', ')} → ${operation.to.join(', ')}) because the snapshot does not carry the ` +
      'existing SQL Server constraint name; use a hand-written migration',
  );
}

function emitUp(operation: ChangeOp): string {
  switch (operation.kind) {
    case 'create_extension':
      throw new UnsupportedFeatureError(
        `extension "${operation.name}"`,
        'mssql',
        `mssql does not support database extensions ("${operation.name}")`,
      );
    case 'create_table':
      return createTable(operation);
    case 'drop_table':
      return `DROP TABLE ${table(operation.table)}`;
    case 'add_column':
      return `ALTER TABLE ${table(operation.table)} ADD ${columnDdl(operation.column, {
        inlinePrimaryKey: operation.column.primaryKey,
        tablePrimaryKey: false,
      })}`;
    case 'drop_column':
      return `ALTER TABLE ${table(operation.table)} DROP COLUMN ${identifier(operation.column)}`;
    case 'alter_column_type':
      return (
        `ALTER TABLE ${table(operation.table)} ALTER COLUMN ${identifier(operation.column)} ` +
        `${alteredType(operation, 'up')}${alterNullability(operation, 'up')}`
      );
    case 'alter_primary_key':
      return primaryKeyRefusal(operation);
    case 'add_foreign_key':
      return (
        `ALTER TABLE ${table(operation.table)} ADD CONSTRAINT ${identifier(operation.fk.name)} ` +
        foreignKeyDdl(operation.fk)
      );
    case 'drop_foreign_key':
      return `ALTER TABLE ${table(operation.table)} DROP CONSTRAINT ${identifier(operation.name)}`;
  }
}

function emitDown(operation: ChangeOp): string {
  switch (operation.kind) {
    case 'create_extension':
      throw new UnsupportedFeatureError(`reverting extension "${operation.name}"`, 'mssql');
    case 'create_table':
      return `DROP TABLE ${table(operation.table)}`;
    case 'drop_table':
      throw new UnsupportedFeatureError(
        `recreating dropped table "${operation.table}"`,
        'mssql',
        `mssql cannot recreate dropped table "${operation.table}" because the drop operation carries no columns; ` +
          'write the down migration by hand',
      );
    case 'add_column':
      return `ALTER TABLE ${table(operation.table)} DROP COLUMN ${identifier(operation.column.name)}`;
    case 'drop_column':
      throw new UnsupportedFeatureError(
        `recreating dropped column "${operation.table}"."${operation.column}"`,
        'mssql',
        'the drop operation carries no SQL type or nullability; write the down migration by hand',
      );
    case 'alter_column_type':
      return (
        `ALTER TABLE ${table(operation.table)} ALTER COLUMN ${identifier(operation.column)} ` +
        `${alteredType(operation, 'down')}${alterNullability(operation, 'down')}`
      );
    case 'alter_primary_key':
      return primaryKeyRefusal({
        ...operation,
        from: operation.to,
        to: operation.from,
      });
    case 'add_foreign_key':
      return `ALTER TABLE ${table(operation.table)} DROP CONSTRAINT ${identifier(operation.fk.name)}`;
    case 'drop_foreign_key':
      throw new UnsupportedFeatureError(
        `recreating foreign key "${operation.name}" on "${operation.table}"`,
        'mssql',
        'the drop operation carries no columns, target or referential actions; write the down migration by hand',
      );
  }
}

function indexColumn(column: IndexColumn, definition: IndexDef): string {
  if (typeof column === 'string') return identifier(column);
  if ('expr' in column) {
    throw new UnsupportedFeatureError(
      `expression index "${definition.name}"`,
      'mssql',
      `mssql does not support an expression index ("${definition.name}" on "${definition.table}" uses ` +
        `${column.expr}); add a computed column and index that instead`,
    );
  }
  if (column.opclass !== undefined) {
    throw new UnsupportedFeatureError(`index operator class ${column.opclass}`, 'mssql');
  }
  return identifier(column.column);
}

function createIndex(definition: IndexDef): string {
  if (definition.method !== undefined && definition.method !== 'btree') {
    throw new UnsupportedFeatureError(
      `index method ${definition.method}`,
      'mssql',
      `mssql does not support the index method ${definition.method} ("${definition.name}" on "${definition.table}")`,
    );
  }
  if (definition.with !== undefined && Object.keys(definition.with).length > 0) {
    throw new UnsupportedFeatureError(
      `index options on "${definition.name}"`,
      'mssql',
      'the current SQL Server index contract does not model WITH options',
    );
  }
  const unique = definition.unique === true ? 'UNIQUE ' : '';
  const columns = definition.columns.map(column => indexColumn(column, definition)).join(', ');
  const predicate = definition.where === undefined ? '' : ` WHERE ${definition.where}`;
  return `CREATE ${unique}INDEX ${identifier(definition.name)} ON ${table(definition.table)} (${columns})${predicate}`;
}

function sequence(definition: SequenceDef): string {
  let sql = `CREATE SEQUENCE ${table(definition.name)}`;
  if (definition.start !== undefined) sql += ` START WITH ${String(definition.start)}`;
  if (definition.increment !== undefined) sql += ` INCREMENT BY ${String(definition.increment)}`;
  return sql;
}

function generatedColumn(definition: GeneratedColumn): string {
  return `${identifier(definition.name)} AS (${definition.expression})${definition.stored === true ? ' PERSISTED' : ''}`;
}

function unsupportedSchemaObject(feature: string, detail?: string): never {
  throw new UnsupportedFeatureError(feature, 'mssql', detail);
}

function emitSchemaObject(operation: SchemaObjectOperation): readonly string[] {
  switch (operation.kind) {
    case 'create_index':
      return [createIndex(operation.definition)];
    case 'check_constraint':
      return [
        `ALTER TABLE ${table(operation.table)} ADD CONSTRAINT ${identifier(operation.name)} ` +
          `CHECK (${operation.expression})`,
      ];
    case 'create_view':
      if (operation.definition.materialized === true) {
        return unsupportedSchemaObject(
          'materialized views',
          'SQL Server indexed views require schema binding and index declarations that the current view contract does not carry',
        );
      }
      return [`CREATE VIEW ${table(operation.definition.name)} AS ${operation.definition.select}`];
    case 'drop_view':
      if (operation.materialized === true) return unsupportedSchemaObject('materialized views');
      return [`DROP VIEW IF EXISTS ${table(operation.name)}`];
    case 'create_sequence':
      return [sequence(operation.definition)];
    case 'generated_column':
      return [generatedColumn(operation.definition)];
    case 'create_schema':
      return [`CREATE SCHEMA ${identifier(operation.name)}`];
    case 'enable_rls':
      return unsupportedSchemaObject('row-level security');
    case 'create_policy':
      return unsupportedSchemaObject('row-level security policy');
    case 'create_extension':
      return unsupportedSchemaObject(
        `extension "${operation.definition.name}"`,
        `mssql does not support database extensions ("${operation.definition.name}")`,
      );
    case 'create_routine':
    case 'drop_routine':
    case 'replace_routine':
      return unsupportedSchemaObject(
        'stored routines',
        'SQL Server CREATE/ALTER and EXEC grammar is not represented by the current routine contract; ' +
          'use a hand-written migration and driver call',
      );
  }
}

function validateSnapshot(snapshot: SchemaSnapshot): void {
  for (const currentTable of snapshot.tables) {
    for (const column of currentTable.columns) mssqlDdlType(column);
  }
}

function validatePlan(plan: MigrationPlan): void {
  validateSnapshot(plan.before);
  validateSnapshot(plan.after);
  for (const operation of plan.operations) emitUp(operation);
}

export const mssqlMigrations: MigrationDialect<'mssql'> = Object.freeze({
  name: 'mssql',
  foreignKeyMode: 'deferred',
  embedded: false,
  validateSnapshot,
  validatePlan,
  ddlType: mssqlDdlType,
  emitUp,
  emitDown,
  emitSchemaObject,
  connection: migrationConnection,
});
