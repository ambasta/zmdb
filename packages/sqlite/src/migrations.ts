import {
  UnsupportedFeatureError,
  type AppliedMigration,
  type MigrationConnection,
  type MigrationDialect,
  type MigrationDriver,
  type MigrationPlan,
  type MigrationTableOptions,
  type SchemaObjectOperation,
} from '@zmdb/query-compiler';
import type {
  ChangeOp,
  ColumnSnapshot,
  ExtensionType,
  ForeignKeySnapshot,
  ReferentialAction,
  SchemaSnapshot,
} from '@zmdb/query-compiler/migrations';
import type { IndexColumn, IndexDef, RoutineDef } from '@zmdb/query-compiler/schema-objects';

const SQLITE_TYPES = Object.freeze({
  serial: 'INTEGER',
  integer: 'INTEGER',
  bigint: 'INTEGER',
  numeric: 'NUMERIC',
  text: 'TEXT',
  varchar: 'TEXT',
  boolean: 'INTEGER',
  timestamp: 'TEXT',
  json: 'TEXT',
  jsonEnum: 'TEXT',
} as const);

const EXTENSION_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function q(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function extensionTypeDdl(type: ExtensionType): string {
  if (!EXTENSION_IDENTIFIER.test(type.name)) {
    throw new TypeError(`extension type name ${JSON.stringify(type.name)} is not a SQL identifier`);
  }
  const rendered = (type.args ?? []).map(argument => {
    if (typeof argument === 'number' && Number.isFinite(argument)) return String(argument);
    if (typeof argument === 'string' && EXTENSION_IDENTIFIER.test(argument)) return argument;
    throw new TypeError(
      `extension type ${type.name} argument ${JSON.stringify(argument)} must be a finite number or SQL identifier`,
    );
  });
  return `${type.name}${rendered.length === 0 ? '' : `(${rendered.join(',')})`}`;
}

function unsupportedExtensionType(type: ExtensionType, column: string, table?: string): never {
  const rendered = extensionTypeDdl(type);
  const location = table === undefined ? `column "${column}"` : `"${table}"."${column}"`;
  throw new UnsupportedFeatureError(
    `extension type ${rendered}`,
    'sqlite',
    `sqlite does not support the extension type ${rendered} on ${location} (extension \`${type.extension}\`); ` +
      'there is no equivalent, and storing it as TEXT would produce a value the database cannot use',
  );
}

function sqliteDdlType(column: ColumnSnapshot): string {
  if (typeof column.type !== 'string') return unsupportedExtensionType(column.type, column.name);
  const mapped: unknown = Reflect.get(SQLITE_TYPES, column.type);
  return typeof mapped === 'string' ? mapped : column.type;
}

function refuseNonRowidSerial(column: string, table: string): never {
  throw new UnsupportedFeatureError(
    `serial column "${table}"."${column}" outside a sole primary key`,
    'sqlite',
    `sqlite can generate serial values only for a sole INTEGER PRIMARY KEY; ` +
      `"${table}"."${column}" is not that key, and SQLite has no standalone sequence or column identity`,
  );
}

function columnDdl(
  column: ColumnSnapshot,
  table: string,
  key: { readonly inline: boolean; readonly tableLevel: boolean },
): string {
  if (typeof column.type !== 'string') unsupportedExtensionType(column.type, column.name, table);
  if (column.type === 'serial' && !key.inline) refuseNonRowidSerial(column.name, table);
  // Only the exact spelling INTEGER PRIMARY KEY aliases SQLite's rowid. Keep a
  // supplied integer key as INT so it cannot silently acquire serial behavior.
  const type = key.inline && column.type === 'integer' ? 'INT' : sqliteDdlType(column);
  const rowidPrimaryKey = key.inline && column.type === 'serial';
  const primaryKey = key.inline ? ' PRIMARY KEY' : '';
  const notNull = rowidPrimaryKey || (!key.inline && column.nullable && !key.tableLevel) ? '' : ' NOT NULL';
  return `${q(column.name)} ${type}${primaryKey}${notNull}`;
}

function primaryKeyDdl(columns: readonly string[]): string {
  return `PRIMARY KEY (${columns.map(q).join(', ')})`;
}

function actionName(action: ReferentialAction): string {
  return action.toUpperCase();
}

function foreignKeyDdl(foreignKey: ForeignKeySnapshot): string {
  if (foreignKey.columns.length === 0 || foreignKey.columns.length !== foreignKey.targetColumns.length) {
    throw new TypeError(
      `foreign key "${foreignKey.name}" must have the same non-zero number of local and target columns`,
    );
  }
  return (
    `FOREIGN KEY (${foreignKey.columns.map(q).join(', ')}) ` +
    `REFERENCES ${q(foreignKey.targetTable)} (${foreignKey.targetColumns.map(q).join(', ')}) ` +
    `ON DELETE ${actionName(foreignKey.onDelete)} ON UPDATE ${actionName(foreignKey.onUpdate)}`
  );
}

function createTableDdl(operation: Extract<ChangeOp, { readonly kind: 'create_table' }>): string {
  if (operation.tableOptions !== undefined) {
    throw new UnsupportedFeatureError(
      `table options on "${operation.table}"`,
      'sqlite',
      `sqlite does not support shard keys, sort keys, or rowstore table options on "${operation.table}"`,
    );
  }
  const inline = operation.primaryKey.length === 1 ? operation.primaryKey[0] : undefined;
  const tableLevel = operation.primaryKey.length > 1 ? new Set(operation.primaryKey) : undefined;
  const definitions = operation.columns.map(column =>
    columnDdl(column, operation.table, {
      inline: column.name === inline,
      tableLevel: tableLevel?.has(column.name) === true,
    }),
  );
  if (operation.primaryKey.length > 1) definitions.push(primaryKeyDdl(operation.primaryKey));
  definitions.push(...operation.foreignKeys.map(foreignKeyDdl));
  return `CREATE TABLE ${q(operation.table)} (${definitions.join(', ')})`;
}

function keyList(columns: readonly string[]): string {
  return `(${columns.join(', ')})`;
}

function refuseAlterPrimaryKey(table: string, from: readonly string[], to: readonly string[]): never {
  throw new UnsupportedFeatureError(
    `altering the primary key of "${table}"`,
    'sqlite',
    `sqlite cannot alter the primary key of "${table}" (${keyList(from)} → ${keyList(to)}); ` +
      'SQLite has no ALTER TABLE form for a key, so this needs a hand-written table rebuild — ' +
      'see the migration guide',
  );
}

function refuseForeignKey(action: 'add' | 'drop', table: string, foreignKey: ForeignKeySnapshot | string): never {
  const name = typeof foreignKey === 'string' ? foreignKey : foreignKey.name;
  throw new UnsupportedFeatureError(
    `${action === 'add' ? 'adding' : 'dropping'} foreign key "${name}" on "${table}"`,
    'sqlite',
    `sqlite cannot ${action} the foreign key "${name}" on "${table}"; ` +
      'SQLite has no ALTER TABLE form for a constraint, so this needs a hand-written table rebuild — ' +
      'see the migration guide',
  );
}

function refuseRecreateDroppedTable(table: string): never {
  throw new UnsupportedFeatureError(
    `recreating dropped table "${table}"`,
    'sqlite',
    `sqlite cannot recreate dropped table "${table}" because the drop operation carries no columns; ` +
      'write the down migration by hand',
  );
}

function refuseRecreateDroppedColumn(table: string, column: string | ColumnSnapshot): never {
  const columnName = typeof column === 'string' ? column : column.name;
  throw new UnsupportedFeatureError(
    `recreating dropped column "${table}"."${columnName}"`,
    'sqlite',
    `sqlite cannot recreate dropped column "${table}"."${columnName}" because the drop operation carries no type, ` +
      'nullability, key, or default metadata; write the down migration by hand',
  );
}

function validateSnapshot(snapshot: SchemaSnapshot): void {
  if (snapshot.extensions.length > 0) {
    const extension = snapshot.extensions[0];
    throw new UnsupportedFeatureError(
      `extension "${extension?.name ?? 'unknown'}"`,
      'sqlite',
      `sqlite does not support database extensions ("${extension?.name ?? 'unknown'}")`,
    );
  }
  for (const table of snapshot.tables) {
    if (table.tableOptions !== undefined) {
      throw new UnsupportedFeatureError(
        `table options on "${table.name}"`,
        'sqlite',
        `sqlite does not support shard keys, sort keys, or rowstore table options on "${table.name}"`,
      );
    }
    for (const column of table.columns) {
      if (typeof column.type !== 'string') unsupportedExtensionType(column.type, column.name, table.name);
      if (column.type === 'serial' && (table.primaryKey.length !== 1 || table.primaryKey[0] !== column.name)) {
        refuseNonRowidSerial(column.name, table.name);
      }
    }
  }
}

function validatePlan(plan: MigrationPlan): void {
  validateSnapshot(plan.before);
  validateSnapshot(plan.after);

  for (const operation of plan.operations) {
    switch (operation.kind) {
      case 'create_extension':
        throw new UnsupportedFeatureError(
          `extension "${operation.name}"`,
          'sqlite',
          `sqlite does not support database extensions ("${operation.name}")`,
        );
      case 'alter_column_type':
        throw new UnsupportedFeatureError(
          'alter column type',
          'sqlite',
          'sqlite cannot alter a column type in place; use a hand-written table rebuild',
        );
      case 'alter_primary_key':
        refuseAlterPrimaryKey(operation.table, operation.from, operation.to);
      case 'add_foreign_key':
        refuseForeignKey('add', operation.table, operation.fk);
      case 'drop_foreign_key':
        refuseForeignKey('drop', operation.table, operation.name);
      default:
        break;
    }
  }
}

function emitUp(operation: ChangeOp): string {
  switch (operation.kind) {
    case 'create_extension':
      throw new UnsupportedFeatureError(
        `extension "${operation.name}"`,
        'sqlite',
        `sqlite does not support database extensions ("${operation.name}")`,
      );
    case 'create_table':
      return createTableDdl(operation);
    case 'drop_table':
      return `DROP TABLE ${q(operation.table)}`;
    case 'add_column':
      return `ALTER TABLE ${q(operation.table)} ADD COLUMN ${columnDdl(operation.column, operation.table, {
        inline: false,
        tableLevel: false,
      })}`;
    case 'drop_column': {
      const columnName = typeof operation.column === 'string' ? operation.column : operation.column.name;
      return `ALTER TABLE ${q(operation.table)} DROP COLUMN ${q(columnName)}`;
    }
    case 'alter_column_type':
    case 'alter_column_default':
    case 'alter_column_unique':
    case 'alter_column_references':
      throw new UnsupportedFeatureError(
        operation.kind.replaceAll('_', ' '),
        'sqlite',
        `sqlite cannot ${operation.kind.replaceAll('_', ' ')} in place; use a hand-written table rebuild`,
      );
    case 'alter_primary_key':
      return refuseAlterPrimaryKey(operation.table, operation.from, operation.to);
    case 'add_foreign_key':
      return refuseForeignKey('add', operation.table, operation.fk);
    case 'drop_foreign_key':
      return refuseForeignKey('drop', operation.table, operation.name);
  }
}

function emitDown(operation: ChangeOp): string {
  switch (operation.kind) {
    case 'create_extension':
      throw new UnsupportedFeatureError(
        `extension "${operation.name}"`,
        'sqlite',
        `sqlite does not support database extensions ("${operation.name}")`,
      );
    case 'create_table':
      return `DROP TABLE ${q(operation.table)}`;
    case 'drop_table':
      return refuseRecreateDroppedTable(operation.table);
    case 'add_column':
      return `ALTER TABLE ${q(operation.table)} DROP COLUMN ${q(operation.column.name)}`;
    case 'drop_column':
      return refuseRecreateDroppedColumn(operation.table, operation.column);
    case 'alter_column_type':
    case 'alter_column_default':
    case 'alter_column_unique':
    case 'alter_column_references':
      throw new UnsupportedFeatureError(
        operation.kind.replaceAll('_', ' '),
        'sqlite',
        `sqlite cannot ${operation.kind.replaceAll('_', ' ')} in place; use a hand-written table rebuild`,
      );
    case 'alter_primary_key':
      return refuseAlterPrimaryKey(operation.table, operation.to, operation.from);
    case 'add_foreign_key':
      return refuseForeignKey('drop', operation.table, operation.fk);
    case 'drop_foreign_key':
      throw new UnsupportedFeatureError(
        `recreating foreign key "${operation.name}" on "${operation.table}"`,
        'sqlite',
        `foreign key "${operation.name}" on "${operation.table}" cannot be recreated automatically because the ` +
          'drop operation does not carry its columns or referential actions; write the down migration by hand',
      );
  }
}

function renderIndexColumn(column: IndexColumn, definition: IndexDef): string {
  if (typeof column === 'string') return q(column);
  if (column.opclass !== undefined) {
    throw new UnsupportedFeatureError(
      `index operator class ${column.opclass}`,
      'sqlite',
      `sqlite does not support the index operator class ${column.opclass} ("${definition.name}")`,
    );
  }
  return 'expr' in column ? column.expr : q(column.column);
}

function createIndexDdl(definition: IndexDef): string {
  if (definition.method !== undefined) {
    throw new UnsupportedFeatureError(
      `index method ${definition.method}`,
      'sqlite',
      `sqlite does not expose selectable index methods ("${definition.name}" on "${definition.table}")`,
    );
  }
  if (definition.with !== undefined && Object.keys(definition.with).length > 0) {
    throw new UnsupportedFeatureError(
      `index options on "${definition.name}"`,
      'sqlite',
      `sqlite does not expose per-index storage options ("${definition.name}" on "${definition.table}")`,
    );
  }
  const unique = definition.unique === true ? 'UNIQUE ' : '';
  const columns = definition.columns.map(column => renderIndexColumn(column, definition)).join(', ');
  const where = definition.where === undefined ? '' : ` WHERE ${definition.where}`;
  return `CREATE ${unique}INDEX ${q(definition.name)} ON ${q(definition.table)} (${columns})${where}`;
}

function routineLabel(definition: RoutineDef): string {
  return `${definition.kind} ${q(definition.name)}`;
}

function refuseRoutine(definition: RoutineDef): never {
  const message =
    `sqlite does not support stored routines (${routineLabel(definition)}); SQLite has no CREATE FUNCTION, ` +
    'so register the function on the connection instead — `node:sqlite` exposes `DatabaseSync#function` — ' +
    'and call it like any other';
  throw new UnsupportedFeatureError(`stored routine ${routineLabel(definition)}`, 'sqlite', message);
}

function emitSchemaObject(operation: SchemaObjectOperation): readonly string[] {
  switch (operation.kind) {
    case 'create_index':
      return [createIndexDdl(operation.definition)];
    case 'check_constraint':
      throw new UnsupportedFeatureError(
        `adding check constraint "${operation.name}" on "${operation.table}"`,
        'sqlite',
        `sqlite cannot add check constraint "${operation.name}" to "${operation.table}" in place; ` +
          'use a hand-written table rebuild',
      );
    case 'create_view':
      if (operation.definition.materialized === true) {
        throw new UnsupportedFeatureError('materialized views', 'sqlite');
      }
      return [`CREATE VIEW ${q(operation.definition.name)} AS ${operation.definition.select}`];
    case 'drop_view':
      if (operation.materialized === true) {
        throw new UnsupportedFeatureError('materialized views', 'sqlite');
      }
      return [`DROP VIEW IF EXISTS ${q(operation.name)}`];
    case 'create_sequence':
      throw new UnsupportedFeatureError('sequences', 'sqlite');
    case 'generated_column': {
      const column = operation.definition;
      return [
        `${q(column.name)} ${column.type} GENERATED ALWAYS AS (${column.expression})${column.stored === true ? ' STORED' : ''}`,
      ];
    }
    case 'create_schema':
      throw new UnsupportedFeatureError('schemas', 'sqlite');
    case 'enable_rls':
    case 'create_policy':
      throw new UnsupportedFeatureError('row-level security', 'sqlite');
    case 'create_extension':
      throw new UnsupportedFeatureError(
        `extension "${operation.definition.name}"`,
        'sqlite',
        `sqlite does not support database extensions ("${operation.definition.name}")`,
      );
    case 'create_routine':
    case 'drop_routine':
      return refuseRoutine(operation.definition);
    case 'replace_routine':
      return refuseRoutine(operation.next);
  }
}

function parseAppliedMigrations(rows: readonly Record<string, unknown>[]): readonly AppliedMigration[] {
  return rows.map((row, index) => {
    const version = row.version;
    const name = row.name;
    const checksum = row.checksum;
    if (
      (typeof version !== 'number' && typeof version !== 'bigint' && typeof version !== 'string') ||
      typeof name !== 'string' ||
      (checksum !== null && typeof checksum !== 'string')
    ) {
      throw new TypeError(`migration ledger row ${String(index)} has an invalid version, name or checksum`);
    }
    const numericVersion = Number(version);
    if (!Number.isSafeInteger(numericVersion)) {
      throw new TypeError(`migration ledger row ${String(index)} version is not a safe integer`);
    }
    return { version: numericVersion, name, checksum };
  });
}

async function migrationChecksum(sql: string): Promise<string> {
  const bytes = new TextEncoder().encode(sql);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function connection(
  driver: MigrationDriver<'sqlite'>,
  options: MigrationTableOptions = {},
): MigrationConnection<'sqlite'> {
  if (options.schema !== undefined) {
    throw new UnsupportedFeatureError(
      `migration schema "${options.schema}"`,
      'sqlite',
      'sqlite has no database schemas; omit migrations.schema',
    );
  }
  const table = q(options.table ?? '_zmdb_migrations');
  const execute = (text: string, parameters: readonly unknown[] = []) => driver.execute({ text, parameters });

  const appliedMigrations = async (): Promise<readonly AppliedMigration[]> =>
    parseAppliedMigrations(await execute(`SELECT version, name, checksum FROM ${table} ORDER BY version`));

  const adapter: MigrationConnection<'sqlite'> = {
    name: 'sqlite',
    dialect: 'sqlite',
    transactionalDdl: true,
    async exec(sql: string): Promise<void> {
      await execute(sql);
    },
    async appliedVersions(): Promise<readonly number[]> {
      return (await appliedMigrations()).map(row => row.version);
    },
    appliedMigrations,
    async recordApplied(version: number, name: string, checksum?: string): Promise<void> {
      await execute(`INSERT INTO ${table} (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)`, [
        version,
        name,
        Date.now(),
        checksum ?? null,
      ]);
    },
    async recordReverted(version: number): Promise<void> {
      await execute(`DELETE FROM ${table} WHERE version = ?`, [version]);
    },
    async ensureVersionTable(): Promise<void> {
      await execute(
        `CREATE TABLE IF NOT EXISTS ${table} (` +
          'version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL, checksum TEXT)',
      );
      try {
        await execute(`SELECT checksum FROM ${table} WHERE 1 = 0`);
      } catch {
        await execute(`ALTER TABLE ${table} ADD COLUMN checksum TEXT`);
      }
    },
    checksum: migrationChecksum,
    async transaction<Result>(run: (nested?: MigrationConnection<'sqlite'>) => Promise<Result>): Promise<Result> {
      if (driver.transaction === undefined) {
        throw new Error(
          'sqlite migrations require a transactional driver; the driver must pin every callback query to one database transaction',
        );
      }
      return driver.transaction(nestedDriver => run(connection(nestedDriver, options)));
    },
  };
  return adapter;
}

export const sqliteMigrations: MigrationDialect<'sqlite'> = {
  name: 'sqlite',
  validateSnapshot,
  validatePlan,
  ddlType: sqliteDdlType,
  emitUp,
  emitDown,
  emitSchemaObject,
  connection,
};
