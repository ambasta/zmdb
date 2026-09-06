import { defineSqlDialect } from '../dialects/index.js';
import type {
  AppliedMigration,
  CatalogSchemaSnapshot,
  ChangeOp,
  ColumnSnapshot,
  CompiledQuery,
  IntrospectOptions,
  IntrospectionDriver,
  MigrationTableOptions,
  PaginationTail,
  SchemaSnapshot,
} from '../index.js';
import {
  DATABASE_CAPABILITY_KEYS,
  OFFICIAL_DATABASES,
  SQL_TYPE_KEYS,
  VERTICAL_CONTRACT_KEYS,
  type CapabilityEvidence,
  type DatabaseCapabilityMatrix,
} from './capability-matrix.js';

export type FrozenReturningStatement = 'insert' | 'upsert' | 'update' | 'delete';
export type FrozenReturningStyle = 'suffix' | 'output' | 'none';

export interface FrozenDatabaseCapabilities {
  readonly returning: Readonly<Record<FrozenReturningStatement, boolean>>;
  readonly transactionalDdl: boolean;
  readonly schemas: boolean;
  readonly sequences: boolean;
  readonly generatedColumns: boolean;
  readonly partialIndexes: boolean;
  readonly foreignKeys: boolean;
  readonly rowLevelSecurity: boolean;
  readonly streaming: boolean;
  readonly cancellation: boolean;
}

export interface FrozenResolvedDialectTraits {
  readonly placeholder: 'numbered' | 'positional' | 'named';
  readonly quote: readonly [open: string, close: string];
  readonly paginate: (tail: PaginationTail) => string;
  readonly paginationRequiresOrder: boolean;
  readonly rowValueIn: boolean;
  readonly returning: Readonly<Record<FrozenReturningStatement, FrozenReturningStyle>>;
  readonly upsert: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  readonly fts: 'tsvector' | 'match' | 'matchPlain' | 'companionTable' | 'none';
  readonly concat: 'operator' | 'function';
  readonly booleanNot: 'not' | 'bitwise';
  readonly types: Readonly<Record<(typeof SQL_TYPE_KEYS)[number], string>>;
  readonly paramLimit: number;
  readonly retryableCodes: readonly string[];
  readonly acceptsOperator: (operator: string) => boolean;
  readonly functions: boolean;
  readonly procedures: boolean;
  readonly tableFunctions: boolean;
  readonly vectorDistance: boolean;
  readonly spatialPredicates: boolean;
}

export interface FrozenIntrospector<Name extends string = string> {
  readonly name: Name;
  snapshot(driver: IntrospectionDriver, options?: IntrospectOptions): Promise<CatalogSchemaSnapshot>;
  normalizeForDrift(snapshot: CatalogSchemaSnapshot, role: 'live' | 'declared'): SchemaSnapshot;
}

export interface FrozenMigrationConnection<Name extends string = string> {
  readonly name: Name;
  readonly transactionalDdl: boolean;
  exec(sql: string): Promise<void> | void;
  appliedVersions(): Promise<readonly number[]> | readonly number[];
  appliedMigrations?(): Promise<readonly AppliedMigration[]> | readonly AppliedMigration[];
  recordApplied(version: number, name: string, checksum?: string): Promise<void> | void;
  recordReverted(version: number): Promise<void> | void;
  ensureVersionTable(): Promise<void> | void;
  checksum?(sql: string): Promise<string> | string;
  transaction<Result>(run: (connection?: FrozenMigrationConnection<Name>) => Promise<Result>): Promise<Result>;
}

export interface FrozenMigrationDriver<Name extends string = string> {
  readonly dialect: FrozenSqlDialect<Name>;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  transaction?<Result>(run: (driver: FrozenMigrationDriver<Name>) => Promise<Result>): Promise<Result>;
}

export interface FrozenMigrationDialect<Name extends string = string> {
  readonly name: Name;
  readonly foreignKeyMode: 'inline' | 'deferred';
  readonly embedded: boolean;
  validateSnapshot(snapshot: SchemaSnapshot): void;
  validatePlan(plan: {
    readonly before: SchemaSnapshot;
    readonly after: SchemaSnapshot;
    readonly operations: readonly ChangeOp[];
  }): void;
  ddlType(column: ColumnSnapshot): string;
  emitUp(operation: ChangeOp): string;
  emitDown(operation: ChangeOp): string;
  emitSchemaObject(operation: { readonly kind: string }): readonly string[];
  connection(driver: FrozenMigrationDriver<Name>, options?: MigrationTableOptions): FrozenMigrationConnection<Name>;
}

export interface FrozenSqlDialect<Name extends string = string> {
  readonly name: Name;
  readonly family: string;
  readonly telemetrySystem: string;
  readonly traits: FrozenResolvedDialectTraits;
  readonly capabilities: FrozenDatabaseCapabilities;
  readonly migrations: FrozenMigrationDialect<Name>;
  readonly introspector: FrozenIntrospector<Name>;
}

export interface FrozenSqlDialectExtension<Name extends string> {
  readonly name: Name;
  readonly telemetrySystem?: string;
  readonly traits?: Omit<Partial<FrozenResolvedDialectTraits>, 'returning' | 'types'> & {
    readonly returning?: Partial<FrozenResolvedDialectTraits['returning']>;
    readonly types?: Partial<FrozenResolvedDialectTraits['types']>;
  };
  readonly capabilities?: Partial<FrozenDatabaseCapabilities> & {
    readonly returning?: Partial<FrozenDatabaseCapabilities['returning']>;
  };
  readonly migrations: FrozenMigrationDialect<Name>;
  readonly introspector: FrozenIntrospector<Name>;
}

export interface FrozenDriver<Name extends string = string> {
  readonly dialect: FrozenSqlDialect<Name>;
  readonly queryTelemetry?: true;
  execute(
    query: CompiledQuery,
    options?: { readonly signal?: AbortSignal; readonly batchSize?: number },
  ): Promise<readonly Record<string, unknown>[]>;
  stream?(
    query: CompiledQuery,
    options?: { readonly signal?: AbortSignal; readonly batchSize?: number },
  ): AsyncIterable<Record<string, unknown>>;
}

export interface FrozenTransactionalDriver<Name extends string = string> extends FrozenDriver<Name> {
  transaction<Result>(run: (driver: FrozenDriver<Name>) => Promise<Result>): Promise<Result>;
}

export interface FrozenDatabaseVertical<Name extends string, Connection, Options = undefined> {
  readonly dialect: FrozenSqlDialect<Name>;
  driver(connection: Connection, options?: Options): FrozenTransactionalDriver<Name>;
}

const EMPTY_SCHEMA: SchemaSnapshot = Object.freeze({
  version: 1,
  tables: [],
  extensions: [],
});

const EMPTY_CATALOG: CatalogSchemaSnapshot = Object.freeze({
  version: 1,
  tables: [],
  extensions: [],
  warnings: [],
});

function renderedType(type: ColumnSnapshot['type']): string {
  if (typeof type === 'string') return type.toUpperCase();
  const args = type.args?.join(', ');
  return args === undefined || args.length === 0 ? type.name : `${type.name}(${args})`;
}

function migrationConnection<Name extends string>(
  dialectName: Name,
  driver: FrozenMigrationDriver<Name>,
): FrozenMigrationConnection<Name> {
  const applied: AppliedMigration[] = [];
  return {
    name: dialectName,
    transactionalDdl: true,
    exec: async sql => {
      await driver.execute({ text: sql, parameters: [] });
    },
    appliedVersions: () => applied.map(migration => migration.version),
    appliedMigrations: () => applied,
    recordApplied: (version, migrationName, checksum = '') => {
      applied.push({ version, name: migrationName, checksum });
    },
    recordReverted: version => {
      const index = applied.findIndex(migration => migration.version === version);
      if (index >= 0) applied.splice(index, 1);
    },
    ensureVersionTable: async () => {
      await driver.execute({
        text: 'CREATE TABLE IF NOT EXISTS <_zmdb_migrations> (<version> INTEGER)',
        parameters: [],
      });
    },
    checksum: sql => `acme:${String(sql.length)}`,
    transaction: run => run(),
  };
}

export function makeSyntheticDialect(): FrozenSqlDialect<'acme'>;
export function makeSyntheticDialect<Name extends string>(
  name: Name,
  options?: { readonly paramLimit?: number },
): FrozenSqlDialect<Name>;
export function makeSyntheticDialect(name = 'acme', options: { readonly paramLimit?: number } = {}): FrozenSqlDialect {
  const introspector: FrozenIntrospector = Object.freeze({
    name,
    snapshot: async (driver: IntrospectionDriver) => {
      await driver.execute({
        text: 'SELECT * FROM <acme_catalog>',
        parameters: [],
      });
      return EMPTY_CATALOG;
    },
    normalizeForDrift: (snapshot: CatalogSchemaSnapshot) => ({
      version: snapshot.version,
      tables: snapshot.tables,
      extensions: snapshot.extensions,
    }),
  });

  const migrations: FrozenMigrationDialect = Object.freeze({
    name,
    foreignKeyMode: 'deferred',
    embedded: false,
    validateSnapshot: () => undefined,
    validatePlan: () => undefined,
    ddlType: (column: ColumnSnapshot) => renderedType(column.type),
    emitUp: (operation: ChangeOp) => `ACME UP ${operation.kind}`,
    emitDown: (operation: ChangeOp) => `ACME DOWN ${operation.kind}`,
    emitSchemaObject: (operation: { readonly kind: string }) => [`ACME OBJECT ${operation.kind}`],
    connection: (driver: FrozenMigrationDriver) => migrationConnection(name, driver),
  });

  const definition: FrozenSqlDialect = {
    name,
    family: 'acme',
    telemetrySystem: 'acme',
    traits: Object.freeze({
      placeholder: 'numbered',
      quote: Object.freeze(['<', '>'] as const),
      paginate: (tail: PaginationTail) =>
        `${tail.limit === undefined ? '' : ` LIMIT ${String(tail.limit)}`}${
          tail.offset === undefined ? '' : ` OFFSET ${String(tail.offset)}`
        }`,
      paginationRequiresOrder: false,
      rowValueIn: true,
      returning: Object.freeze({
        insert: 'suffix',
        upsert: 'suffix',
        update: 'suffix',
        delete: 'suffix',
      }),
      upsert: 'onConflict',
      fts: 'none',
      concat: 'operator',
      booleanNot: 'not',
      types: Object.freeze({
        serial: 'SERIAL',
        integer: 'INTEGER',
        bigint: 'BIGINT',
        numeric: 'NUMERIC',
        text: 'TEXT',
        varchar: 'VARCHAR',
        boolean: 'BOOLEAN',
        timestamp: 'TIMESTAMP',
        json: 'JSON',
        jsonEnum: 'TEXT',
      }),
      paramLimit: options.paramLimit ?? 999,
      retryableCodes: Object.freeze([]),
      acceptsOperator: (operator: string) => ['=', '!=', '<', '<=', '>', '>='].includes(operator),
      functions: true,
      procedures: true,
      tableFunctions: false,
      vectorDistance: false,
      spatialPredicates: false,
    }),
    capabilities: Object.freeze({
      returning: Object.freeze({
        insert: true,
        upsert: true,
        update: true,
        delete: true,
      }),
      transactionalDdl: true,
      schemas: false,
      sequences: false,
      generatedColumns: true,
      partialIndexes: true,
      foreignKeys: true,
      rowLevelSecurity: false,
      streaming: false,
      cancellation: false,
    }),
    migrations,
    introspector,
  };
  defineSqlDialect(definition);
  return definition;
}

function keys(value: object): readonly string[] {
  return Object.keys(value).toSorted();
}

function exactKeys(label: string, value: object, expected: readonly string[]): void {
  const actual = keys(value);
  const wanted = [...expected].toSorted();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    throw new TypeError(`${label} keys are ${actual.join(', ')}; expected ${wanted.join(', ')}`);
  }
}

export function assertDialectConformance(dialect: FrozenSqlDialect): void {
  exactKeys('SQL type', dialect.traits.types, SQL_TYPE_KEYS);
  exactKeys('returning trait', dialect.traits.returning, ['insert', 'upsert', 'update', 'delete']);
  exactKeys('returning capability', dialect.capabilities.returning, ['insert', 'upsert', 'update', 'delete']);

  for (const statement of ['insert', 'upsert', 'update', 'delete'] as const) {
    const supported = dialect.traits.returning[statement] !== 'none';
    if (dialect.capabilities.returning[statement] !== supported) {
      throw new TypeError(`${dialect.name} has inconsistent RETURNING evidence for ${statement}`);
    }
  }

  if (dialect.migrations.name !== dialect.name) {
    throw new TypeError(`${dialect.name} carries migrations for ${dialect.migrations.name}`);
  }
  if (dialect.introspector.name !== dialect.name) {
    throw new TypeError(`${dialect.name} carries an introspector for ${dialect.introspector.name}`);
  }
}

function isEvidence(value: unknown): value is CapabilityEvidence {
  if (value === null || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  return (
    (kind === 'expectation' && ['string', 'number', 'boolean'].includes(typeof Reflect.get(value, 'value'))) ||
    (kind === 'refusal' &&
      typeof Reflect.get(value, 'feature') === 'string' &&
      Reflect.get(value, 'feature').length > 0)
  );
}

export function capabilityMatrixProblems(matrix: unknown): readonly string[] {
  const problems: string[] = [];
  if (matrix === null || typeof matrix !== 'object') {
    return ['capability matrix must be an object'];
  }

  exactKeys('database matrix', matrix, OFFICIAL_DATABASES);
  for (const database of OFFICIAL_DATABASES) {
    const row = Reflect.get(matrix, database);
    if (row === null || typeof row !== 'object') {
      problems.push(`${database} has no capability row`);
      continue;
    }

    for (const [section, expected] of [
      ['capabilities', DATABASE_CAPABILITY_KEYS],
      ['sqlTypes', SQL_TYPE_KEYS],
      ['verticals', VERTICAL_CONTRACT_KEYS],
    ] as const) {
      const values = Reflect.get(row, section);
      if (values === null || typeof values !== 'object') {
        problems.push(`${database}.${section} must be an object`);
        continue;
      }
      const actual = keys(values);
      const wanted = [...expected].toSorted();
      if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
        problems.push(`${database}.${section} keys are ${actual.join(', ')}; expected ${wanted.join(', ')}`);
      }
      for (const key of expected) {
        if (!isEvidence(Reflect.get(values, key))) {
          problems.push(`${database}.${section}.${key} needs an exact expectation or explicit refusal`);
        }
      }
    }

    if (Reflect.get(row, 'packedConsumer') !== `fixtures/database-${database}`) {
      problems.push(`${database}.packedConsumer must be fixtures/database-${database}`);
    }
  }
  return problems;
}

export function assertCapabilityMatrix(matrix: DatabaseCapabilityMatrix): void {
  const problems = capabilityMatrixProblems(matrix);
  if (problems.length > 0) {
    throw new TypeError(`invalid database capability matrix:\n${problems.join('\n')}`);
  }
}

export function emptySchemaSnapshot(): SchemaSnapshot {
  return EMPTY_SCHEMA;
}
