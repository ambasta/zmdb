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
import type {
  ChangeOp,
  ColumnSnapshot,
  ExtensionType,
  ForeignKeySnapshot,
  ReferentialAction,
  SchemaSnapshot,
} from '@zmdb/query-compiler/migrations';
import type {
  ExtensionDef,
  GeneratedColumn,
  IndexColumn,
  IndexDef,
  IndexMethod,
  RlsPolicy,
  RoutineDef,
  RoutineSqlType,
  SequenceDef,
  ViewDef,
} from '@zmdb/query-compiler/schema-objects';

import { POSTGRES_TYPES } from './constants.js';

export interface PostgresMigrationOptions {
  /** Type overrides inherited by a PostgreSQL-family child. */
  readonly types?: Readonly<Partial<DialectTypeMap>>;
}

const EXTENSION_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INDEX_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INDEX_OPTIONS = {
  btree: [],
  hash: [],
  gin: [],
  gist: [],
  brin: [],
  ivfflat: ['lists'],
  hnsw: ['m', 'ef_construction'],
} satisfies Readonly<Record<IndexMethod, readonly string[]>>;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function qualifiedTable(schema: string | undefined, table: string): string {
  return schema === undefined ? quoteIdentifier(table) : `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
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

function scalarType(types: DialectTypeMap, type: string): string {
  const values: Readonly<Record<string, string>> = types;
  return values[type] ?? type;
}

function postgresDdlType(types: DialectTypeMap, column: ColumnSnapshot): string {
  if (typeof column.type !== 'string') return extensionTypeDdl(column.type);
  const mapped = scalarType(types, column.type);
  if (column.type === 'varchar' && column.length !== undefined && mapped === 'VARCHAR') {
    return `${mapped}(${column.length})`;
  }
  return mapped;
}

function columnDdl(
  types: DialectTypeMap,
  column: ColumnSnapshot,
  key: { readonly inline: boolean; readonly tableLevel: boolean } = {
    inline: column.primaryKey,
    tableLevel: false,
  },
): string {
  const primaryKey = key.inline ? ' PRIMARY KEY' : '';
  const notNull = !key.inline && (!column.nullable || key.tableLevel) ? ' NOT NULL' : '';
  return `${quoteIdentifier(column.name)} ${postgresDdlType(types, column)}${primaryKey}${notNull}`;
}

function primaryKeyDdl(columns: readonly string[]): string {
  return `PRIMARY KEY (${columns.map(quoteIdentifier).join(', ')})`;
}

function referentialActionDdl(action: ReferentialAction): string {
  return action.toUpperCase();
}

function foreignKeyDdl(foreignKey: ForeignKeySnapshot): string {
  const columns = foreignKey.columns.map(quoteIdentifier).join(', ');
  const targetColumns = foreignKey.targetColumns.map(quoteIdentifier).join(', ');
  return (
    `FOREIGN KEY (${columns}) REFERENCES ${quoteIdentifier(foreignKey.targetTable)} (${targetColumns}) ` +
    `ON DELETE ${referentialActionDdl(foreignKey.onDelete)} ` +
    `ON UPDATE ${referentialActionDdl(foreignKey.onUpdate)}`
  );
}

function createTableDdl(
  types: DialectTypeMap,
  operation: Extract<ChangeOp, { readonly kind: 'create_table' }>,
): string {
  const inline = operation.primaryKey.length === 1 ? operation.primaryKey[0] : undefined;
  const tableLevel = operation.primaryKey.length > 1 ? new Set(operation.primaryKey) : undefined;
  const definitions = operation.columns.map(column =>
    columnDdl(types, column, {
      inline: column.name === inline,
      tableLevel: tableLevel?.has(column.name) === true,
    }),
  );
  if (operation.primaryKey.length > 1) definitions.push(primaryKeyDdl(operation.primaryKey));
  return `CREATE TABLE ${quoteIdentifier(operation.table)} (${definitions.join(', ')})`;
}

function alterPrimaryKeyDdl(table: string, from: readonly string[], to: readonly string[]): string {
  const clauses: string[] = [];
  if (from.length > 0) clauses.push(`DROP CONSTRAINT ${quoteIdentifier(`${table}_pkey`)}`);
  if (to.length > 0) clauses.push(`ADD ${primaryKeyDdl(to)}`);
  if (clauses.length === 0) throw new Error(`primary key change for "${table}" has no before or after columns`);
  return `ALTER TABLE ${quoteIdentifier(table)} ${clauses.join(', ')}`;
}

function addForeignKeyDdl(table: string, foreignKey: ForeignKeySnapshot): string {
  return (
    `ALTER TABLE ${quoteIdentifier(table)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} ` +
    foreignKeyDdl(foreignKey)
  );
}

function dropForeignKeyDdl(table: string, name: string): string {
  return `ALTER TABLE ${quoteIdentifier(table)} DROP CONSTRAINT ${quoteIdentifier(name)}`;
}

function createExtensionDdl(definition: ExtensionDef): string {
  const schema = definition.schema === undefined ? '' : ` WITH SCHEMA ${quoteIdentifier(definition.schema)}`;
  const version = definition.version === undefined ? '' : ` VERSION ${quoteLiteral(definition.version)}`;
  return `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(definition.name)}${schema}${version}`;
}

function isIndexMethod(value: string): value is IndexMethod {
  return Object.hasOwn(INDEX_OPTIONS, value);
}

function indexMethod(value: unknown, definition: IndexDef): IndexMethod | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && isIndexMethod(value)) return value;
  throw new TypeError(`invalid index method ${JSON.stringify(value)} ("${definition.name}")`);
}

function indexOptions(definition: IndexDef, method: IndexMethod | undefined): string {
  const options = definition.with;
  if (options === undefined || Object.keys(options).length === 0) return '';
  if (method === undefined) {
    throw new TypeError(`index options require a method ("${definition.name}")`);
  }
  const allowed: readonly string[] = INDEX_OPTIONS[method];
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw new TypeError(
        `${method} does not take the option \`${key}\` ("${definition.name}"); ` +
          `${method} options are (${allowed.join(', ')})`,
      );
    }
  }
  const rendered: string[] = [];
  for (const key of allowed) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`${method} option \`${key}\` must be a non-negative integer ("${definition.name}")`);
    }
    rendered.push(`${key} = ${value}`);
  }
  return rendered.length === 0 ? '' : ` WITH (${rendered.join(', ')})`;
}

type StructuredIndexColumn = Exclude<IndexColumn, string>;
type ExpressionIndexColumn = Extract<StructuredIndexColumn, { readonly expr: string }>;

function isExpressionColumn(column: StructuredIndexColumn): column is ExpressionIndexColumn {
  return Object.hasOwn(column, 'expr');
}

function renderIndexColumn(column: IndexColumn, definition: IndexDef): string {
  if (typeof column === 'string') return quoteIdentifier(column);
  const expression = isExpressionColumn(column);
  const value = expression ? column.expr : column.column;
  const rendered = expression ? value : quoteIdentifier(value);
  if (column.opclass === undefined) return rendered;
  if (!INDEX_IDENTIFIER.test(column.opclass)) {
    throw new TypeError(
      `index operator class ${JSON.stringify(column.opclass)} is not a SQL identifier ("${definition.name}")`,
    );
  }
  return `${rendered} ${column.opclass}`;
}

function createIndexDdl(definition: IndexDef): string {
  const method = indexMethod(definition.method, definition);
  if (definition.unique === true && method !== undefined && method !== 'btree') {
    throw new UnsupportedFeatureError(
      `unique ${method} index`,
      'postgres',
      `postgres does not support a unique ${method} index ("${definition.name}" on "${definition.table}")`,
    );
  }
  const columns = definition.columns.map(column => renderIndexColumn(column, definition)).join(', ');
  const unique = definition.unique === true ? 'UNIQUE ' : '';
  const using = method === undefined ? '' : ` USING ${method}`;
  const where = definition.where === undefined ? '' : ` WHERE ${definition.where}`;
  return (
    `CREATE ${unique}INDEX ${quoteIdentifier(definition.name)} ON ${quoteIdentifier(definition.table)}` +
    `${using} (${columns})${indexOptions(definition, method)}${where}`
  );
}

function createViewDdl(definition: ViewDef): string {
  const materialized = definition.materialized === true ? 'MATERIALIZED ' : '';
  return `CREATE ${materialized}VIEW ${quoteIdentifier(definition.name)} AS ${definition.select}`;
}

function dropViewDdl(name: string, materialized?: boolean): string {
  return `DROP ${materialized === true ? 'MATERIALIZED ' : ''}VIEW IF EXISTS ${quoteIdentifier(name)}`;
}

function createSequenceDdl(definition: SequenceDef): string {
  let ddl = `CREATE SEQUENCE ${quoteIdentifier(definition.name)}`;
  if (definition.start !== undefined) ddl += ` START ${definition.start}`;
  if (definition.increment !== undefined) ddl += ` INCREMENT ${definition.increment}`;
  return ddl;
}

function generatedColumnDdl(column: GeneratedColumn): string {
  const stored = column.stored === true ? ' STORED' : '';
  return `${quoteIdentifier(column.name)} ${column.type} GENERATED ALWAYS AS (${column.expression})${stored}`;
}

function createPolicyDdl(policy: RlsPolicy): string {
  const command = policy.command ?? 'ALL';
  return (
    `CREATE POLICY ${quoteIdentifier(policy.name)} ON ${quoteIdentifier(policy.table)} ` +
    `FOR ${command} USING (${policy.using})`
  );
}

function routineLabel(definition: RoutineDef): string {
  return `${definition.kind} ${quoteIdentifier(definition.name)}`;
}

function assertRoutineSupported(definition: RoutineDef): void {
  for (const parameter of definition.params) {
    if (parameter.mode === 'out' || parameter.mode === 'inout') {
      throw new UnsupportedFeatureError(
        `postgres routine ${routineLabel(definition)} has unsupported ${parameter.mode} parameter ${quoteIdentifier(parameter.name)}`,
        'postgres',
      );
    }
  }
}

function routineTypeDdl(types: DialectTypeMap, type: RoutineSqlType | 'void'): string {
  if (type === 'void') return 'VOID';
  return scalarType(types, type === 'serial' ? 'integer' : type);
}

function routineParametersDdl(types: DialectTypeMap, definition: RoutineDef): string {
  return definition.params
    .map(parameter => `${quoteIdentifier(parameter.name)} ${routineTypeDdl(types, parameter.type)}`)
    .join(', ');
}

function routineReturns(types: DialectTypeMap, definition: RoutineDef): string {
  if (definition.kind === 'procedure') {
    if (definition.returns !== undefined) {
      throw new TypeError(`${routineLabel(definition)} cannot declare a return type`);
    }
    return '';
  }
  if (definition.returns === undefined) {
    throw new TypeError(`${routineLabel(definition)} must declare a return type`);
  }
  const setof = definition.returns.setof === true ? 'SETOF ' : '';
  return ` RETURNS ${setof}${routineTypeDdl(types, definition.returns.type)}`;
}

function dollarQuoteTag(body: string): string {
  for (let suffix = 0; ; suffix++) {
    const tag = suffix === 0 ? '$zmdb$' : `$zmdb${suffix}$`;
    if (!body.includes(tag)) return tag;
  }
}

function createRoutineDdl(types: DialectTypeMap, definition: RoutineDef): string {
  assertRoutineSupported(definition);
  const kind = definition.kind.toUpperCase();
  const head = `${kind} ${quoteIdentifier(definition.name)}(${routineParametersDdl(types, definition)})`;
  const language = definition.language ?? 'plpgsql';
  const tag = dollarQuoteTag(definition.body);
  return (
    `CREATE OR REPLACE ${head}${routineReturns(types, definition)} ` +
    `LANGUAGE ${language} AS ${tag}\n${definition.body}\n${tag}`
  );
}

function dropRoutineDdl(types: DialectTypeMap, definition: RoutineDef): string {
  assertRoutineSupported(definition);
  const signature = definition.params.map(parameter => routineTypeDdl(types, parameter.type)).join(', ');
  return `DROP ${definition.kind.toUpperCase()} IF EXISTS ${quoteIdentifier(definition.name)}(${signature})`;
}

function sameRoutineSignature(previous: RoutineDef, next: RoutineDef): boolean {
  if (previous.kind !== next.kind || previous.name !== next.name || previous.params.length !== next.params.length) {
    return false;
  }
  if (previous.params.some((parameter, index) => parameter.type !== next.params[index]?.type)) {
    return false;
  }
  if (previous.kind === 'procedure') return true;
  return previous.returns?.type === next.returns?.type && previous.returns?.setof === next.returns?.setof;
}

function replaceRoutineStatements(
  types: DialectTypeMap,
  previous: RoutineDef | undefined,
  next: RoutineDef,
): readonly string[] {
  const create = createRoutineDdl(types, next);
  return previous === undefined || sameRoutineSignature(previous, next)
    ? [create]
    : [dropRoutineDdl(types, previous), create];
}

function schemaObjectStatements(types: DialectTypeMap, operation: SchemaObjectOperation): readonly string[] {
  switch (operation.kind) {
    case 'create_index':
      return [createIndexDdl(operation.definition)];
    case 'check_constraint':
      return [
        `ALTER TABLE ${quoteIdentifier(operation.table)} ADD CONSTRAINT ` +
          `${quoteIdentifier(operation.name)} CHECK (${operation.expression})`,
      ];
    case 'create_view':
      return [createViewDdl(operation.definition)];
    case 'drop_view':
      return [dropViewDdl(operation.name, operation.materialized)];
    case 'create_sequence':
      return [createSequenceDdl(operation.definition)];
    case 'generated_column':
      return [generatedColumnDdl(operation.definition)];
    case 'create_schema':
      return [`CREATE SCHEMA ${quoteIdentifier(operation.name)}`];
    case 'enable_rls':
      return [`ALTER TABLE ${quoteIdentifier(operation.table)} ENABLE ROW LEVEL SECURITY`];
    case 'create_policy':
      return [createPolicyDdl(operation.definition)];
    case 'create_extension':
      return [createExtensionDdl(operation.definition)];
    case 'create_routine':
      return [createRoutineDdl(types, operation.definition)];
    case 'drop_routine':
      return [dropRoutineDdl(types, operation.definition)];
    case 'replace_routine':
      return replaceRoutineStatements(types, operation.previous, operation.next);
  }
}

function emitUp(types: DialectTypeMap, operation: ChangeOp): string {
  switch (operation.kind) {
    case 'create_extension':
      return createExtensionDdl(operation);
    case 'create_table':
      return createTableDdl(types, operation);
    case 'drop_table':
      return `DROP TABLE ${quoteIdentifier(operation.table)}`;
    case 'add_column':
      return `ALTER TABLE ${quoteIdentifier(operation.table)} ADD COLUMN ` + columnDdl(types, operation.column);
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(operation.table)} DROP COLUMN ` + quoteIdentifier(operation.column);
    case 'alter_column_type':
      return (
        `ALTER TABLE ${quoteIdentifier(operation.table)} ALTER COLUMN ` +
        `${quoteIdentifier(operation.column)} TYPE ` +
        postgresDdlType(types, {
          name: operation.column,
          type: operation.to,
          nullable: true,
          primaryKey: false,
        })
      );
    case 'alter_primary_key':
      return alterPrimaryKeyDdl(operation.table, operation.from, operation.to);
    case 'add_foreign_key':
      return addForeignKeyDdl(operation.table, operation.fk);
    case 'drop_foreign_key':
      return dropForeignKeyDdl(operation.table, operation.name);
  }
}

function emitDown(types: DialectTypeMap, operation: ChangeOp): string {
  switch (operation.kind) {
    case 'create_extension':
      throw new Error(
        `extension "${operation.name}" is not dropped automatically; write a hand-authored migration after checking dependants`,
      );
    case 'create_table':
      return `DROP TABLE ${quoteIdentifier(operation.table)}`;
    case 'drop_table':
      return `CREATE TABLE ${quoteIdentifier(operation.table)} ()`;
    case 'add_column':
      return `ALTER TABLE ${quoteIdentifier(operation.table)} DROP COLUMN ` + quoteIdentifier(operation.column.name);
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(operation.table)} ADD COLUMN ` + quoteIdentifier(operation.column);
    case 'alter_column_type':
      return (
        `ALTER TABLE ${quoteIdentifier(operation.table)} ALTER COLUMN ` +
        `${quoteIdentifier(operation.column)} TYPE ` +
        postgresDdlType(types, {
          name: operation.column,
          type: operation.from,
          nullable: true,
          primaryKey: false,
        })
      );
    case 'alter_primary_key':
      return alterPrimaryKeyDdl(operation.table, operation.to, operation.from);
    case 'add_foreign_key':
      return dropForeignKeyDdl(operation.table, operation.fk.name);
    case 'drop_foreign_key':
      throw new Error(
        `foreign key "${operation.name}" on "${operation.table}" cannot be recreated automatically because the drop operation ` +
          'does not carry its columns or referential actions; write the down migration by hand',
      );
  }
}

function migrationConnection<Name extends string>(
  name: Name,
  driver: MigrationDriver<Name>,
  options: MigrationTableOptions = {},
): MigrationConnection<Name> {
  const table = qualifiedTable(options.schema, options.table ?? '_zmdb_migrations');
  const execute = (text: string, parameters: readonly unknown[] = []): Promise<readonly Record<string, unknown>[]> =>
    driver.execute({ text, parameters });

  const appliedMigrations = async (): Promise<readonly AppliedMigration[]> => {
    const rows = await execute(`SELECT version, name, checksum FROM ${table} ORDER BY version`);
    return rows.map((row, index) => {
      const version = row['version'];
      const migrationName = row['name'];
      const checksum = row['checksum'];
      if (
        (typeof version !== 'number' && typeof version !== 'bigint' && typeof version !== 'string') ||
        typeof migrationName !== 'string' ||
        (checksum !== null && typeof checksum !== 'string')
      ) {
        throw new TypeError(`migration ledger row ${String(index)} has an invalid version, name or checksum`);
      }
      const numericVersion = Number(version);
      if (!Number.isSafeInteger(numericVersion)) {
        throw new TypeError(`migration ledger row ${String(index)} version is not a safe integer`);
      }
      return { version: numericVersion, name: migrationName, checksum };
    });
  };

  const transaction = async <Result>(
    run: (connection?: MigrationConnection<Name>) => Promise<Result>,
  ): Promise<Result> => {
    if (driver.transaction === undefined) {
      throw new Error(
        `${name} migrations require a transactional driver; the driver must pin every callback query to one client`,
      );
    }
    return driver.transaction(transactionDriver => run(migrationConnection(name, transactionDriver, options)));
  };

  return {
    name,
    dialect: driver.dialect,
    transactionalDdl: true,
    async exec(sql) {
      await execute(sql);
    },
    async appliedVersions() {
      return (await appliedMigrations()).map(row => row.version);
    },
    appliedMigrations,
    async recordApplied(version, migrationName, checksum) {
      await execute(`INSERT INTO ${table} (version, name, applied_at, checksum) VALUES ($1, $2, $3, $4)`, [
        version,
        migrationName,
        Date.now(),
        checksum ?? null,
      ]);
    },
    async recordReverted(version) {
      await execute(`DELETE FROM ${table} WHERE version = $1`, [version]);
    },
    async ensureVersionTable() {
      await execute(
        `CREATE TABLE IF NOT EXISTS ${table} (` +
          'version BIGINT PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL, checksum TEXT)',
      );
      await execute(`ALTER TABLE ${table} ALTER COLUMN version TYPE BIGINT`);
      try {
        await execute(`SELECT checksum FROM ${table} WHERE 1 = 0`);
      } catch {
        await execute(`ALTER TABLE ${table} ADD COLUMN checksum TEXT`);
      }
    },
    checksum: migrationChecksum,
    transaction,
  };
}

async function migrationChecksum(sql: string): Promise<string> {
  const bytes = new TextEncoder().encode(sql);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export function postgresFamilyMigrations<Name extends string>(
  name: Name,
  options: PostgresMigrationOptions = {},
): MigrationDialect<Name> {
  const types: DialectTypeMap = Object.freeze({
    ...POSTGRES_TYPES,
    ...options.types,
  });
  return Object.freeze({
    name,
    validateSnapshot(_snapshot: SchemaSnapshot): void {},
    validatePlan(_plan: MigrationPlan): void {},
    ddlType(column: ColumnSnapshot): string {
      return postgresDdlType(types, column);
    },
    emitUp(operation: ChangeOp): string {
      return emitUp(types, operation);
    },
    emitDown(operation: ChangeOp): string {
      return emitDown(types, operation);
    },
    emitSchemaObject(operation: SchemaObjectOperation): readonly string[] {
      return schemaObjectStatements(types, operation);
    },
    connection(driver: MigrationDriver<Name>, tableOptions?: MigrationTableOptions): MigrationConnection<Name> {
      return migrationConnection(name, driver, tableOptions);
    },
  });
}
