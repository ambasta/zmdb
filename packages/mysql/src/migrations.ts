import type {
  ChangeOp,
  ColumnSnapshot,
  ExtensionType,
  ForeignKeySnapshot,
  ReferentialAction,
  SchemaSnapshot,
} from '@zmdb/migrations';
import {
  UnsupportedFeatureError,
  type AppliedMigration,
  type DialectTypeMap,
  type MigrationConnection,
  type MigrationDialect,
  type MigrationDriver,
  type MigrationPlan,
  type MigrationTableOptions,
  type SchemaObjectOperation,
} from '@zmdb/query-compiler';
import type { IndexColumn, IndexDef, RoutineDef, RoutineSqlType } from '@zmdb/query-compiler/schema-objects';

const TYPES = Object.freeze({
  serial: 'INT AUTO_INCREMENT',
  integer: 'INT',
  bigint: 'BIGINT',
  numeric: 'DECIMAL',
  text: 'TEXT',
  varchar: 'VARCHAR',
  boolean: 'TINYINT(1)',
  timestamp: 'DATETIME(3)',
  json: 'JSON',
  jsonEnum: 'TEXT',
});

const EXTENSION_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type CreateTableOperation = Extract<ChangeOp, { readonly kind: 'create_table' }>;

export interface MysqlTableDdlHelpers {
  readonly quote: (identifier: string) => string;
  readonly keyColumns: (columns: readonly string[]) => string;
}

export interface MysqlTableDdlExtension {
  readonly createPrefix: (operation: CreateTableOperation) => string;
  readonly definitions: (operation: CreateTableOperation, helpers: MysqlTableDdlHelpers) => readonly string[];
}

export interface MysqlMigrationOverrides {
  readonly types?: Readonly<Partial<DialectTypeMap>>;
  readonly table?: MysqlTableDdlExtension;
  readonly ledger?: {
    readonly createPrefix: string;
    readonly definitions?: readonly string[];
  };
}

function quote(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``;
}

function extensionType(type: ExtensionType): string {
  if (!EXTENSION_IDENTIFIER.test(type.name)) {
    throw new TypeError(`extension type name ${JSON.stringify(type.name)} is not a SQL identifier`);
  }
  const argumentsSql = (type.args ?? []).map(argument => {
    if (typeof argument === 'number' && Number.isFinite(argument)) return String(argument);
    if (typeof argument === 'string' && EXTENSION_IDENTIFIER.test(argument)) return argument;
    throw new TypeError(
      `extension type ${type.name} argument ${JSON.stringify(argument)} must be a finite number or SQL identifier`,
    );
  });
  return `${type.name}${argumentsSql.length === 0 ? '' : `(${argumentsSql.join(',')})`}`;
}

function unsupported<Name extends string>(name: Name, feature: string, message?: string): UnsupportedFeatureError {
  return new UnsupportedFeatureError(feature, name, message);
}

function ddlType<Name extends string>(name: Name, types: DialectTypeMap, column: ColumnSnapshot): string {
  if (typeof column.type !== 'string') {
    const rendered = extensionType(column.type);
    throw unsupported(
      name,
      `extension type ${rendered}`,
      `${name} does not support extension type ${rendered} on column "${column.name}"`,
    );
  }
  const mapped = Reflect.get(types, column.type);
  const scalar = typeof mapped === 'string' ? mapped : column.type;
  if (column.type === 'varchar') {
    if (column.length === undefined) return 'TEXT';
    if (!Number.isSafeInteger(column.length) || column.length <= 0) {
      throw new TypeError(`varchar column "${column.name}" length must be a positive safe integer`);
    }
    return `VARCHAR(${String(column.length)})`;
  }
  if (column.type === 'serial' && !column.primaryKey) return `${scalar} UNIQUE`;
  return scalar;
}

function columnDdl<Name extends string>(
  name: Name,
  types: DialectTypeMap,
  table: string,
  column: ColumnSnapshot,
  key: { readonly inline: boolean; readonly tableLevel: boolean },
): string {
  const primary = key.inline ? ' PRIMARY KEY' : '';
  const notNull = !key.inline && (!column.nullable || key.tableLevel) ? ' NOT NULL' : '';
  const unique = column.unique === true && column.type !== 'serial' && !key.inline ? ' UNIQUE' : '';
  return `${quote(column.name)} ${ddlType(name, types, column)}${primary}${notNull}${unique}`;
}

function keyColumns(columns: readonly string[]): string {
  return columns.map(quote).join(', ');
}

function actionSql<Name extends string>(name: Name, constraint: string, action: ReferentialAction): string {
  if (action === 'set default') {
    throw unsupported(
      name,
      `SET DEFAULT on foreign key "${constraint}"`,
      `SET DEFAULT on foreign key "${constraint}" is not supported by MySQL; InnoDB accepts the syntax but refuses the constraint`,
    );
  }
  return action.toUpperCase();
}

function supportIndexName<Name extends string>(name: Name, foreignKey: ForeignKeySnapshot): string {
  const index = `${foreignKey.name}_idx`;
  if (index.length > 64) {
    throw unsupported(
      name,
      `supporting index "${index}"`,
      `the MySQL supporting index "${index}" is ${String(index.length)} characters long; MySQL's limit is 64`,
    );
  }
  return index;
}

function foreignKeyConstraint<Name extends string>(name: Name, foreignKey: ForeignKeySnapshot): string {
  if (foreignKey.columns.length === 0 || foreignKey.columns.length !== foreignKey.targetColumns.length) {
    throw new TypeError(`foreign key "${foreignKey.name}" must map one or more equally sized column lists`);
  }
  return (
    `CONSTRAINT ${quote(foreignKey.name)} FOREIGN KEY (${keyColumns(foreignKey.columns)}) ` +
    `REFERENCES ${quote(foreignKey.targetTable)} (${keyColumns(foreignKey.targetColumns)}) ` +
    `ON DELETE ${actionSql(name, foreignKey.name, foreignKey.onDelete)} ` +
    `ON UPDATE ${actionSql(name, foreignKey.name, foreignKey.onUpdate)}`
  );
}

function createTable<Name extends string>(
  name: Name,
  types: DialectTypeMap,
  tableExtension: MysqlTableDdlExtension | undefined,
  operation: CreateTableOperation,
): string {
  if (operation.tableOptions !== undefined && tableExtension === undefined) {
    throw unsupported(
      name,
      `table options on "${operation.table}"`,
      `${name} does not model SingleStore shard keys, sort keys, or rowstore options`,
    );
  }
  const available = new Set(operation.columns.map(column => column.name));
  for (const primary of operation.primaryKey) {
    if (!available.has(primary)) throw new TypeError(`primary key on "${operation.table}" names "${primary}"`);
  }
  const inline = operation.primaryKey.length === 1 ? operation.primaryKey[0] : undefined;
  const tableLevel = operation.primaryKey.length > 1 ? new Set(operation.primaryKey) : undefined;
  const definitions = operation.columns.map(column =>
    columnDdl(name, types, operation.table, column, {
      inline: column.name === inline,
      tableLevel: tableLevel?.has(column.name) === true,
    }),
  );
  if (operation.primaryKey.length > 1) {
    definitions.push(`PRIMARY KEY (${keyColumns(operation.primaryKey)})`);
  }
  for (const foreignKey of operation.foreignKeys) {
    for (const column of foreignKey.columns) {
      if (!available.has(column)) {
        throw new TypeError(
          `foreign key "${foreignKey.name}" on "${operation.table}" names unknown column "${column}"`,
        );
      }
    }
    definitions.push(`INDEX ${quote(supportIndexName(name, foreignKey))} (${keyColumns(foreignKey.columns)})`);
    definitions.push(foreignKeyConstraint(name, foreignKey));
  }
  if (tableExtension !== undefined) {
    definitions.push(
      ...tableExtension.definitions(
        operation,
        Object.freeze({
          quote,
          keyColumns,
        }),
      ),
    );
  }
  const prefix = tableExtension?.createPrefix(operation) ?? 'CREATE TABLE';
  return `${prefix} ${quote(operation.table)} (${definitions.join(', ')})`;
}

function addForeignKey<Name extends string>(name: Name, table: string, foreignKey: ForeignKeySnapshot): string {
  const index =
    `CREATE INDEX ${quote(supportIndexName(name, foreignKey))} ON ${quote(table)} ` +
    `(${keyColumns(foreignKey.columns)})`;
  const constraint = `ALTER TABLE ${quote(table)} ADD ${foreignKeyConstraint(name, foreignKey)}`;
  return `${index}; ${constraint}`;
}

function dropForeignKey(table: string, constraint: string, supportIndex: boolean): string {
  const drop = `ALTER TABLE ${quote(table)} DROP FOREIGN KEY ${quote(constraint)}`;
  return supportIndex ? `${drop}; DROP INDEX ${quote(`${constraint}_idx`)} ON ${quote(table)}` : drop;
}

function alteredType<Name extends string>(
  name: Name,
  types: DialectTypeMap,
  operation: Extract<ChangeOp, { readonly kind: 'alter_column_type' }>,
  direction: 'up' | 'down',
): string {
  const nullable = direction === 'up' ? operation.toNullable : operation.fromNullable;
  if (nullable === undefined) {
    throw unsupported(
      name,
      `altering "${operation.table}"."${operation.column}" without nullability metadata`,
      'MySQL MODIFY COLUMN must restate NULL or NOT NULL; generate the operation from snapshots or provide nullability explicitly',
    );
  }
  const type = direction === 'up' ? operation.to : operation.from;
  return `${ddlType(name, types, {
    name: operation.column,
    type,
    nullable,
    primaryKey: false,
  })}${nullable ? ' NULL' : ' NOT NULL'}`;
}

function alterPrimaryKey(table: string, from: readonly string[], to: readonly string[]): string {
  const clauses: string[] = [];
  if (from.length > 0) clauses.push('DROP PRIMARY KEY');
  if (to.length > 0) clauses.push(`ADD PRIMARY KEY (${keyColumns(to)})`);
  if (clauses.length === 0) throw new TypeError(`primary key change for "${table}" has no columns`);
  return `ALTER TABLE ${quote(table)} ${clauses.join(', ')}`;
}

function emitUp<Name extends string>(
  name: Name,
  types: DialectTypeMap,
  tableExtension: MysqlTableDdlExtension | undefined,
  operation: ChangeOp,
): string {
  switch (operation.kind) {
    case 'create_extension':
      throw unsupported(name, `extension "${operation.name}"`);
    case 'create_table':
      return createTable(name, types, tableExtension, operation);
    case 'drop_table':
      return `DROP TABLE ${quote(operation.table)}`;
    case 'add_column':
      return (
        `ALTER TABLE ${quote(operation.table)} ADD COLUMN ` +
        columnDdl(name, types, operation.table, operation.column, {
          inline: operation.column.primaryKey,
          tableLevel: false,
        })
      );
    case 'drop_column':
      return `ALTER TABLE ${quote(operation.table)} DROP COLUMN ${quote(operation.column)}`;
    case 'alter_column_type':
      return (
        `ALTER TABLE ${quote(operation.table)} MODIFY COLUMN ${quote(operation.column)} ` +
        alteredType(name, types, operation, 'up')
      );
    case 'alter_primary_key':
      return alterPrimaryKey(operation.table, operation.from, operation.to);
    case 'add_foreign_key':
      return addForeignKey(name, operation.table, operation.fk);
    case 'drop_foreign_key':
      return dropForeignKey(operation.table, operation.name, false);
  }
}

function emitDown<Name extends string>(name: Name, types: DialectTypeMap, operation: ChangeOp): string {
  switch (operation.kind) {
    case 'create_extension':
      throw unsupported(name, `extension "${operation.name}"`);
    case 'create_table':
      return `DROP TABLE ${quote(operation.table)}`;
    case 'drop_table':
      throw unsupported(
        name,
        `recreating dropped table "${operation.table}"`,
        `the drop operation for "${operation.table}" carries no columns; write the down migration explicitly`,
      );
    case 'add_column':
      return `ALTER TABLE ${quote(operation.table)} DROP COLUMN ${quote(operation.column.name)}`;
    case 'drop_column':
      throw unsupported(
        name,
        `recreating dropped column "${operation.table}"."${operation.column}"`,
        'the drop operation carries no type or nullability; write the down migration explicitly',
      );
    case 'alter_column_type':
      return (
        `ALTER TABLE ${quote(operation.table)} MODIFY COLUMN ${quote(operation.column)} ` +
        alteredType(name, types, operation, 'down')
      );
    case 'alter_primary_key':
      return alterPrimaryKey(operation.table, operation.to, operation.from);
    case 'add_foreign_key':
      return dropForeignKey(operation.table, operation.fk.name, true);
    case 'drop_foreign_key':
      throw unsupported(
        name,
        `recreating foreign key "${operation.name}"`,
        'the drop operation carries no columns or referential actions; write the down migration explicitly',
      );
  }
}

function indexColumn<Name extends string>(name: Name, definition: IndexDef, column: IndexColumn): string {
  if (typeof column === 'string') return quote(column);
  if ('expr' in column) {
    throw unsupported(
      name,
      `expression index "${definition.name}"`,
      `${name} does not support an expression index ("${definition.name}" on "${definition.table}" uses ${column.expr}); add a generated column and index that instead`,
    );
  }
  if (column.opclass !== undefined) {
    throw unsupported(name, `index operator class ${column.opclass}`);
  }
  return quote(column.column);
}

function createIndex<Name extends string>(name: Name, definition: IndexDef): string {
  if (definition.where !== undefined) {
    throw unsupported(
      name,
      `partial index "${definition.name}"`,
      `${name} does not support the partial index "${definition.name}" because MySQL has no predicate-index syntax`,
    );
  }
  if (definition.with !== undefined && Object.keys(definition.with).length > 0) {
    throw unsupported(name, `index options on "${definition.name}"`);
  }
  const method = definition.method;
  if (method !== undefined && method !== 'btree' && method !== 'hash') {
    throw unsupported(name, `index method ${method}`);
  }
  if (definition.columns.length === 0) throw new TypeError(`index "${definition.name}" must name a column`);
  const unique = definition.unique === true ? 'UNIQUE ' : '';
  const using = method === undefined ? '' : ` USING ${method.toUpperCase()}`;
  return (
    `CREATE ${unique}INDEX ${quote(definition.name)}${using} ON ${quote(definition.table)} ` +
    `(${definition.columns.map(column => indexColumn(name, definition, column)).join(', ')})`
  );
}

function routineType(types: DialectTypeMap, type: RoutineSqlType): string {
  const mapped = Reflect.get(types, type);
  return typeof mapped === 'string' ? (type === 'serial' ? 'INT' : mapped) : type;
}

function routineLabel(definition: RoutineDef): string {
  return `${definition.kind} ${quote(definition.name)}`;
}

function assertRoutine<Name extends string>(name: Name, definition: RoutineDef): void {
  for (const parameter of definition.params) {
    if (parameter.mode === 'out' || parameter.mode === 'inout') {
      throw unsupported(name, `${routineLabel(definition)} has unsupported ${parameter.mode} parameter`);
    }
  }
  if (definition.language !== undefined) {
    throw unsupported(
      name,
      `${routineLabel(definition)} cannot declare language ${JSON.stringify(definition.language)}`,
    );
  }
  if (definition.kind === 'procedure' && definition.returns !== undefined) {
    throw new TypeError(`${routineLabel(definition)} cannot declare a return type`);
  }
  if (definition.kind === 'function') {
    if (definition.returns === undefined) throw new TypeError(`${routineLabel(definition)} must declare a return type`);
    if (definition.returns.setof === true || definition.returns.type === 'void') {
      throw unsupported(name, `${routineLabel(definition)} cannot return a set or void`);
    }
  }
}

function createRoutine<Name extends string>(name: Name, types: DialectTypeMap, definition: RoutineDef): string {
  assertRoutine(name, definition);
  const parameters = definition.params
    .map(parameter => `${quote(parameter.name)} ${routineType(types, parameter.type)}`)
    .join(', ');
  const returnType = definition.kind === 'function' ? definition.returns?.type : undefined;
  if (returnType === 'void') throw unsupported(name, `${routineLabel(definition)} cannot return void`);
  const returns = returnType === undefined ? '' : ` RETURNS ${routineType(types, returnType)}`;
  const deterministic =
    definition.kind === 'function'
      ? ` ${definition.deterministic === true ? 'DETERMINISTIC' : 'NOT DETERMINISTIC'}`
      : '';
  return (
    `CREATE ${definition.kind.toUpperCase()} ${quote(definition.name)}(${parameters})${returns}${deterministic} ` +
    `MODIFIES SQL DATA SQL SECURITY INVOKER\n${definition.body}`
  );
}

function dropRoutine<Name extends string>(name: Name, definition: RoutineDef): string {
  assertRoutine(name, definition);
  return `DROP ${definition.kind.toUpperCase()} IF EXISTS ${quote(definition.name)}`;
}

function emitSchemaObject<Name extends string>(
  name: Name,
  types: DialectTypeMap,
  operation: SchemaObjectOperation,
): readonly string[] {
  switch (operation.kind) {
    case 'create_index':
      return [createIndex(name, operation.definition)];
    case 'check_constraint':
      return [
        `ALTER TABLE ${quote(operation.table)} ADD CONSTRAINT ${quote(operation.name)} CHECK (${operation.expression})`,
      ];
    case 'create_view':
      if (operation.definition.materialized === true) throw unsupported(name, 'materialized views');
      return [`CREATE VIEW ${quote(operation.definition.name)} AS ${operation.definition.select}`];
    case 'drop_view':
      if (operation.materialized === true) throw unsupported(name, 'materialized views');
      return [`DROP VIEW IF EXISTS ${quote(operation.name)}`];
    case 'create_sequence':
      throw unsupported(name, `sequence "${operation.definition.name}"`);
    case 'generated_column':
      return [
        `${quote(operation.definition.name)} ${operation.definition.type} GENERATED ALWAYS AS ` +
          `(${operation.definition.expression})${operation.definition.stored === true ? ' STORED' : ''}`,
      ];
    case 'create_schema':
      return [`CREATE SCHEMA ${quote(operation.name)}`];
    case 'enable_rls':
    case 'create_policy':
      throw unsupported(name, 'row-level security');
    case 'create_extension':
      throw unsupported(name, `extension "${operation.definition.name}"`);
    case 'create_routine':
      return [createRoutine(name, types, operation.definition)];
    case 'drop_routine':
      return [dropRoutine(name, operation.definition)];
    case 'replace_routine':
      return [dropRoutine(name, operation.previous ?? operation.next), createRoutine(name, types, operation.next)];
  }
}

function validateSnapshot<Name extends string>(
  name: Name,
  types: DialectTypeMap,
  tableExtension: MysqlTableDdlExtension | undefined,
  snapshot: SchemaSnapshot,
): void {
  if (snapshot.extensions.length > 0) {
    throw unsupported(name, `extension "${snapshot.extensions[0]?.name ?? 'unknown'}"`);
  }
  for (const table of snapshot.tables) {
    if (table.tableOptions !== undefined && tableExtension === undefined) {
      throw unsupported(name, `table options on "${table.name}"`);
    }
    for (const column of table.columns) ddlType(name, types, column);
    for (const foreignKey of table.foreignKeys) foreignKeyConstraint(name, foreignKey);
  }
}

function splitGeneratedStatements(sql: string): readonly string[] {
  if (!sql.startsWith('CREATE INDEX ') && !sql.startsWith('ALTER TABLE ')) return [sql];
  let quoteCharacter: "'" | '"' | '`' | undefined;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quoteCharacter !== undefined) {
      if (character === quoteCharacter) {
        if (sql[index + 1] === quoteCharacter) index += 1;
        else quoteCharacter = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quoteCharacter = character;
      continue;
    }
    if (character !== ';') continue;
    const first = sql.slice(0, index).trim();
    const second = sql.slice(index + 1).trim();
    const generatedPair =
      (first.startsWith('CREATE INDEX ') && /^ALTER TABLE .* ADD CONSTRAINT /u.test(second)) ||
      (first.startsWith('ALTER TABLE ') && first.includes(' DROP FOREIGN KEY ') && second.startsWith('DROP INDEX '));
    return generatedPair ? [first, second] : [sql];
  }
  return [sql];
}

function migrationConnection<Name extends string>(
  name: Name,
  driver: MigrationDriver<Name>,
  options: MigrationTableOptions = {},
  ledger: MysqlMigrationOverrides['ledger'],
): MigrationConnection<Name> {
  const tableName = options.table ?? '_zmdb_migrations';
  const table = options.schema === undefined ? quote(tableName) : `${quote(options.schema)}.${quote(tableName)}`;

  async function execute(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly Record<string, unknown>[]> {
    return driver.execute({ text, parameters });
  }

  async function appliedMigrations(): Promise<readonly AppliedMigration[]> {
    const rows = await execute(`SELECT version, name, checksum FROM ${table} ORDER BY version`);
    return rows.map((row, index) => {
      const numericVersion = Number(row.version);
      if (!Number.isSafeInteger(numericVersion) || typeof row.name !== 'string') {
        throw new TypeError(`migration ledger row ${String(index)} has an invalid version or name`);
      }
      const checksum = row.checksum;
      if (checksum !== null && typeof checksum !== 'string') {
        throw new TypeError(`migration ledger row ${String(index)} has an invalid checksum`);
      }
      return { version: numericVersion, name: row.name, checksum };
    });
  }

  const connection: MigrationConnection<Name> = {
    name,
    dialect: driver.dialect,
    transactionalDdl: false,
    async exec(sql) {
      for (const statement of splitGeneratedStatements(sql)) await execute(statement);
    },
    async appliedVersions() {
      return (await appliedMigrations()).map(row => row.version);
    },
    appliedMigrations,
    async recordApplied(version, migrationName, checksum) {
      await execute(`INSERT INTO ${table} (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)`, [
        version,
        migrationName,
        Date.now(),
        checksum ?? null,
      ]);
    },
    async recordReverted(version) {
      await execute(`DELETE FROM ${table} WHERE version = ?`, [version]);
    },
    async ensureVersionTable() {
      const createPrefix = ledger?.createPrefix ?? 'CREATE TABLE';
      const extraDefinitions =
        ledger?.definitions === undefined || ledger.definitions.length === 0
          ? ''
          : `, ${ledger.definitions.join(', ')}`;
      await execute(
        `${createPrefix} IF NOT EXISTS ${table} (` +
          `version BIGINT PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL, checksum TEXT${extraDefinitions})`,
      );
      await execute(`ALTER TABLE ${table} MODIFY COLUMN version BIGINT NOT NULL`);
      try {
        await execute(`SELECT checksum FROM ${table} WHERE 1 = 0`);
      } catch {
        await execute(`ALTER TABLE ${table} ADD COLUMN checksum TEXT`);
      }
    },
    async checksum(sql) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    },
    transaction<Result>(run: (nested?: MigrationConnection<Name>) => Promise<Result>): Promise<Result> {
      return run(connection);
    },
  };
  return connection;
}

function resolvedTypes(overrides: MysqlMigrationOverrides): DialectTypeMap {
  return Object.freeze({
    ...TYPES,
    ...overrides.types,
  });
}

export function mysqlFamilyMigrations<Name extends string>(
  name: Name,
  overrides: MysqlMigrationOverrides = {},
): MigrationDialect<Name> {
  const types = resolvedTypes(overrides);
  const tableExtension =
    overrides.table === undefined
      ? undefined
      : Object.freeze({
          createPrefix: overrides.table.createPrefix,
          definitions: overrides.table.definitions,
        });
  const ledger =
    overrides.ledger === undefined
      ? undefined
      : Object.freeze({
          createPrefix: overrides.ledger.createPrefix,
          ...(overrides.ledger.definitions === undefined
            ? {}
            : { definitions: Object.freeze([...overrides.ledger.definitions]) }),
        });
  const migrations: MigrationDialect<Name> = {
    name,
    validateSnapshot: (snapshot: SchemaSnapshot) => validateSnapshot(name, types, tableExtension, snapshot),
    validatePlan(plan: MigrationPlan) {
      validateSnapshot(name, types, tableExtension, plan.before);
      validateSnapshot(name, types, tableExtension, plan.after);
      for (const operation of plan.operations) emitUp(name, types, tableExtension, operation);
    },
    ddlType: (column: ColumnSnapshot) => ddlType(name, types, column),
    emitUp: (operation: ChangeOp) => emitUp(name, types, tableExtension, operation),
    emitDown: (operation: ChangeOp) => emitDown(name, types, operation),
    emitSchemaObject: (operation: SchemaObjectOperation) => emitSchemaObject(name, types, operation),
    connection: (driver: MigrationDriver<Name>, options?: MigrationTableOptions) =>
      migrationConnection(name, driver, options, ledger),
  };
  return Object.freeze(migrations);
}

export function createMysqlMigrations<Name extends string>(name: Name): MigrationDialect<Name> {
  return mysqlFamilyMigrations(name);
}
