import type { CompiledQuery } from '../compiled-query.js';
import type { CatalogSchemaSnapshot } from '../introspect/types.js';
import type { ChangeOp, ColumnSnapshot, SchemaSnapshot } from '../migrations/types.js';
import type {
  ExtensionDef,
  GeneratedColumn,
  IndexDef,
  RlsPolicy,
  RoutineDef,
  SequenceDef,
  ViewDef,
} from '../schema-objects/types.js';

export type PlaceholderStyle = 'numbered' | 'positional' | 'named';
export type ReturningStatement = 'insert' | 'upsert' | 'update' | 'delete';
export type ReturningStyle = 'suffix' | 'output' | 'none';
export type ReturningCapability = Readonly<Record<ReturningStatement, ReturningStyle>>;

export type DialectReturningColumn =
  | string
  | {
      readonly column: string;
      readonly alias: string;
    };

export interface DialectReturningSql {
  readonly inline: string;
  readonly suffix: string;
}

export interface DialectReturningContext {
  readonly dialect: SqlDialect;
  readonly statement: ReturningStatement;
  readonly row: 'new' | 'old';
  readonly columns: readonly DialectReturningColumn[];
}

export interface DialectUpsertConflict {
  readonly action: 'update' | 'ignore';
  readonly target?: readonly string[] | undefined;
  readonly updateFields?: readonly string[] | Readonly<Record<string, unknown>> | undefined;
}

export interface DialectUpsertReferences {
  readonly current: string;
  readonly proposed: string;
}

export interface DialectUpsertContext {
  readonly dialect: SqlDialect;
  readonly table: string;
  readonly columns: readonly string[];
  readonly placeholders: readonly string[];
  readonly conflict: DialectUpsertConflict;
  readonly returning: DialectReturningSql;
  readonly renderUpdateValue: (column: string, value: unknown, references: DialectUpsertReferences) => string;
  readonly isProposedValue: (value: unknown) => boolean;
}

export interface DialectCompiler {
  returning(context: DialectReturningContext): DialectReturningSql;
  upsert(context: DialectUpsertContext): string;
}

export interface DialectOutbox {
  readonly createTable: string;
  readonly pendingIndex: 'filtered' | 'full';
  readonly epochLiteral: string;
  readonly createdAtDefault: string;
  boundedTextType(length: number): string;
}

export interface DatabaseCapabilities {
  readonly returning: Readonly<Record<ReturningStatement, boolean>>;
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

export const DIALECT_SQL_TYPES = [
  'serial',
  'integer',
  'bigint',
  'numeric',
  'text',
  'varchar',
  'boolean',
  'timestamp',
  'json',
  'jsonEnum',
] as const;
export type DialectSqlType = (typeof DIALECT_SQL_TYPES)[number];
export type DialectTypeMap = Readonly<Record<DialectSqlType, string>>;

export interface PaginationTail {
  readonly limit?: number;
  readonly offset?: number;
  readonly ordered: boolean;
}

export interface ResolvedDialectTraits {
  readonly placeholder: PlaceholderStyle;
  readonly quote: readonly [open: string, close: string];
  readonly paginate: (tail: PaginationTail) => string;
  readonly paginationRequiresOrder: boolean;
  readonly rowValueIn: boolean;
  readonly returning: ReturningCapability;
  readonly upsert: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  readonly fts: 'tsvector' | 'match' | 'matchPlain' | 'companionTable' | 'none';
  readonly concat: 'operator' | 'function';
  readonly booleanNot: 'not' | 'bitwise';
  readonly types: DialectTypeMap;
  readonly paramLimit: number;
  readonly retryableCodes: readonly string[];
  readonly acceptsOperator: (operator: string) => boolean;
  readonly functions: boolean;
  readonly procedures: boolean;
  readonly tableFunctions: boolean;
  readonly vectorDistance: boolean;
  readonly spatialPredicates: boolean;
}

export interface IntrospectionDriver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface IntrospectOptions {
  readonly schemas?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface Introspector<Name extends string = string> {
  readonly name: Name;
  /** Temporary compatibility alias for the pre-#668 factory surface. */
  readonly dialect?: Name;
  snapshot(driver: IntrospectionDriver, options?: IntrospectOptions): Promise<CatalogSchemaSnapshot>;
  normalizeForDrift(snapshot: SchemaSnapshot, role: 'live' | 'declared'): SchemaSnapshot;
}

export type SchemaObjectOperation =
  | { readonly kind: 'create_index'; readonly definition: IndexDef }
  | {
      readonly kind: 'check_constraint';
      readonly table: string;
      readonly name: string;
      readonly expression: string;
    }
  | { readonly kind: 'create_view'; readonly definition: ViewDef }
  | { readonly kind: 'drop_view'; readonly name: string; readonly materialized?: boolean }
  | { readonly kind: 'create_sequence'; readonly definition: SequenceDef }
  | { readonly kind: 'generated_column'; readonly definition: GeneratedColumn }
  | { readonly kind: 'create_schema'; readonly name: string }
  | { readonly kind: 'enable_rls'; readonly table: string }
  | { readonly kind: 'create_policy'; readonly definition: RlsPolicy }
  | { readonly kind: 'create_extension'; readonly definition: ExtensionDef }
  | { readonly kind: 'create_routine'; readonly definition: RoutineDef }
  | { readonly kind: 'drop_routine'; readonly definition: RoutineDef }
  | {
      readonly kind: 'replace_routine';
      readonly previous?: RoutineDef;
      readonly next: RoutineDef;
    };

export interface MigrationPlan {
  readonly before: SchemaSnapshot;
  readonly after: SchemaSnapshot;
  readonly operations: readonly ChangeOp[];
}

export interface MigrationTableOptions {
  readonly table?: string;
  readonly schema?: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  /** `null` identifies a ledger row written before checksums were introduced. */
  readonly checksum: string | null;
}

export interface MigrationExecutionDriver<Name extends string = string> {
  readonly dialect: SqlDialect<Name>;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface MigrationDriver<Name extends string = string> extends MigrationExecutionDriver<Name> {
  transaction?<Result>(run: (driver: MigrationExecutionDriver<Name>) => Promise<Result>): Promise<Result>;
}

export interface MigrationConnection<Name extends string = string> {
  readonly name: Name;
  readonly dialect?: Name | SqlDialect<Name>;
  readonly transactionalDdl: boolean;
  exec(sql: string): Promise<void> | void;
  appliedVersions(): Promise<readonly number[]> | readonly number[];
  appliedMigrations?(): Promise<readonly AppliedMigration[]> | readonly AppliedMigration[];
  recordApplied(version: number, name: string, checksum?: string): Promise<void> | void;
  recordReverted(version: number): Promise<void> | void;
  ensureVersionTable(): Promise<void> | void;
  checksum?(sql: string): Promise<string> | string;
  transaction?<Result>(run: (connection?: MigrationConnection<Name>) => Promise<Result>): Promise<Result>;
}

export interface MigrationDialect<Name extends string = string> {
  readonly name: Name;
  /** Whether CREATE TABLE owns foreign keys or they are emitted as later ALTER statements. */
  readonly foreignKeyMode: 'inline' | 'deferred';
  /** Whether this dialect can execute the browser-safe embedded migration format. */
  readonly embedded: boolean;
  validateSnapshot(snapshot: SchemaSnapshot): void;
  validatePlan(plan: MigrationPlan): void;
  ddlType(column: ColumnSnapshot): string;
  emitUp(operation: ChangeOp): string;
  emitDown(operation: ChangeOp): string;
  emitSchemaObject(operation: SchemaObjectOperation): readonly string[];
  connection(driver: MigrationDriver<Name>, options?: MigrationTableOptions): MigrationConnection<Name>;
}

export interface SqlDialect<Name extends string = string> {
  readonly name: Name;
  readonly family: string;
  readonly telemetrySystem: string;
  readonly traits: ResolvedDialectTraits;
  readonly capabilities: DatabaseCapabilities;
  readonly migrations: MigrationDialect<Name>;
  readonly introspector: Introspector<Name>;
  readonly compiler?: DialectCompiler;
  readonly outbox?: DialectOutbox;
}

export interface SqlDialectDefinition<Name extends string> extends SqlDialect<Name> {}

export interface SqlDialectExtension<Name extends string> {
  readonly name: Name;
  readonly telemetrySystem?: string;
  readonly traits?: Omit<Partial<ResolvedDialectTraits>, 'returning' | 'types'> & {
    readonly returning?: Partial<ResolvedDialectTraits['returning']>;
    readonly types?: Partial<ResolvedDialectTraits['types']>;
  };
  readonly capabilities?: Partial<DatabaseCapabilities> & {
    readonly returning?: Partial<DatabaseCapabilities['returning']>;
  };
  readonly migrations: MigrationDialect<Name>;
  readonly introspector: Introspector<Name>;
  readonly compiler?: DialectCompiler;
  readonly outbox?: DialectOutbox;
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key));
  return Object.freeze(value);
}

function exactKeys(label: string, value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).toSorted();
  const wanted = [...expected].toSorted();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    throw new TypeError(`${label} keys are ${actual.join(', ')}; expected ${wanted.join(', ')}`);
  }
}

function requiredFunction(value: object, key: string, label: string): void {
  if (typeof Reflect.get(value, key) !== 'function') {
    throw new TypeError(`${label}.${key} must be a function`);
  }
}

function assertSqlDialect(dialect: SqlDialect): void {
  if (dialect.name.trim().length === 0) throw new TypeError('dialect name must not be empty');
  if (dialect.family.trim().length === 0) throw new TypeError(`${dialect.name} dialect family must not be empty`);
  if (dialect.telemetrySystem.trim().length === 0) {
    throw new TypeError(`${dialect.name} dialect telemetry system must not be empty`);
  }
  exactKeys('dialect trait', dialect.traits, [
    'placeholder',
    'quote',
    'paginate',
    'paginationRequiresOrder',
    'rowValueIn',
    'returning',
    'upsert',
    'fts',
    'concat',
    'booleanNot',
    'types',
    'paramLimit',
    'retryableCodes',
    'acceptsOperator',
    'functions',
    'procedures',
    'tableFunctions',
    'vectorDistance',
    'spatialPredicates',
  ]);
  exactKeys('SQL type', dialect.traits.types, DIALECT_SQL_TYPES);
  exactKeys('returning trait', dialect.traits.returning, ['insert', 'upsert', 'update', 'delete']);
  exactKeys('database capability', dialect.capabilities, [
    'returning',
    'transactionalDdl',
    'schemas',
    'sequences',
    'generatedColumns',
    'partialIndexes',
    'foreignKeys',
    'rowLevelSecurity',
    'streaming',
    'cancellation',
  ]);
  exactKeys('returning capability', dialect.capabilities.returning, ['insert', 'upsert', 'update', 'delete']);

  if (dialect.traits.quote.length !== 2 || dialect.traits.quote.some(part => typeof part !== 'string')) {
    throw new TypeError(`${dialect.name} dialect quote must contain two strings`);
  }
  if (!Number.isSafeInteger(dialect.traits.paramLimit) || dialect.traits.paramLimit <= 0) {
    throw new TypeError(`${dialect.name} dialect paramLimit must be a positive safe integer`);
  }
  if (dialect.traits.retryableCodes.some(code => typeof code !== 'string')) {
    throw new TypeError(`${dialect.name} dialect retryableCodes must contain strings`);
  }
  for (const key of ['paginate', 'acceptsOperator'] as const) {
    requiredFunction(dialect.traits, key, `${dialect.name} dialect traits`);
  }
  if (typeof dialect.traits.paginationRequiresOrder !== 'boolean') {
    throw new TypeError(`${dialect.name} dialect trait paginationRequiresOrder must be boolean`);
  }
  if (typeof dialect.traits.rowValueIn !== 'boolean') {
    throw new TypeError(`${dialect.name} dialect trait rowValueIn must be boolean`);
  }
  for (const key of ['functions', 'procedures', 'tableFunctions', 'vectorDistance', 'spatialPredicates'] as const) {
    if (typeof dialect.traits[key] !== 'boolean') {
      throw new TypeError(`${dialect.name} dialect trait ${key} must be boolean`);
    }
  }
  for (const key of [
    'transactionalDdl',
    'schemas',
    'sequences',
    'generatedColumns',
    'partialIndexes',
    'foreignKeys',
    'rowLevelSecurity',
    'streaming',
    'cancellation',
  ] as const) {
    if (typeof dialect.capabilities[key] !== 'boolean') {
      throw new TypeError(`${dialect.name} capability ${key} must be boolean`);
    }
  }
  for (const statement of ['insert', 'upsert', 'update', 'delete'] as const) {
    const supported = dialect.traits.returning[statement] !== 'none';
    if (typeof dialect.capabilities.returning[statement] !== 'boolean') {
      throw new TypeError(`${dialect.name} RETURNING capability ${statement} must be boolean`);
    }
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
  for (const key of [
    'validateSnapshot',
    'validatePlan',
    'ddlType',
    'emitUp',
    'emitDown',
    'emitSchemaObject',
    'connection',
  ] as const) {
    requiredFunction(dialect.migrations, key, `${dialect.name} migrations`);
  }
  for (const key of ['snapshot', 'normalizeForDrift'] as const) {
    requiredFunction(dialect.introspector, key, `${dialect.name} introspector`);
  }
  const compilerRequired =
    Object.values(dialect.traits.returning).includes('output') || dialect.traits.upsert === 'merge';
  if (compilerRequired && dialect.compiler === undefined) {
    throw new TypeError(`${dialect.name} requires a compiler strategy for its returning or upsert traits`);
  }
  if (dialect.compiler !== undefined) {
    for (const key of ['returning', 'upsert'] as const) {
      requiredFunction(dialect.compiler, key, `${dialect.name} compiler`);
    }
  }
  if (dialect.outbox !== undefined) {
    exactKeys(`${dialect.name} outbox`, dialect.outbox, [
      'createTable',
      'pendingIndex',
      'epochLiteral',
      'createdAtDefault',
      'boundedTextType',
    ]);
    if (dialect.outbox.pendingIndex !== 'filtered' && dialect.outbox.pendingIndex !== 'full') {
      throw new TypeError(`${dialect.name} outbox pendingIndex must be filtered or full`);
    }
    for (const key of ['createTable', 'epochLiteral', 'createdAtDefault'] as const) {
      if (typeof dialect.outbox[key] !== 'string' || dialect.outbox[key].length === 0) {
        throw new TypeError(`${dialect.name} outbox ${key} must be a non-empty string`);
      }
    }
    requiredFunction(dialect.outbox, 'boundedTextType', `${dialect.name} outbox`);
  }
}

export function defineSqlDialect<Name extends string>(definition: SqlDialectDefinition<Name>): SqlDialect<Name> {
  assertSqlDialect(definition);
  return deepFreeze(definition);
}

export function extendSqlDialect<Parent extends string, Name extends string>(
  parent: SqlDialect<Parent>,
  extension: SqlDialectExtension<Name>,
): SqlDialect<Name> {
  const traitOverrides = extension.traits;
  const capabilityOverrides = extension.capabilities;
  const quote = traitOverrides?.quote ?? parent.traits.quote;
  const traits: ResolvedDialectTraits = {
    ...parent.traits,
    ...traitOverrides,
    quote: Object.freeze([quote[0], quote[1]]),
    returning: Object.freeze({
      ...parent.traits.returning,
      ...traitOverrides?.returning,
    }),
    types: Object.freeze({
      ...parent.traits.types,
      ...traitOverrides?.types,
    }),
    retryableCodes: Object.freeze([...(traitOverrides?.retryableCodes ?? parent.traits.retryableCodes)]),
  };
  const capabilities: DatabaseCapabilities = {
    ...parent.capabilities,
    ...capabilityOverrides,
    returning: Object.freeze({
      ...parent.capabilities.returning,
      ...capabilityOverrides?.returning,
    }),
  };
  return defineSqlDialect({
    name: extension.name,
    family: parent.family,
    telemetrySystem: extension.telemetrySystem ?? parent.telemetrySystem,
    traits,
    capabilities,
    migrations: extension.migrations,
    introspector: extension.introspector,
    ...((extension.compiler ?? parent.compiler) === undefined
      ? {}
      : { compiler: extension.compiler ?? parent.compiler }),
    ...((extension.outbox ?? parent.outbox) === undefined ? {} : { outbox: extension.outbox ?? parent.outbox }),
  });
}

export function isSqlDialect(value: unknown): value is SqlDialect {
  if (value === null || typeof value !== 'object') return false;
  return (
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'family') === 'string' &&
    typeof Reflect.get(value, 'telemetrySystem') === 'string' &&
    Reflect.get(value, 'traits') !== null &&
    typeof Reflect.get(value, 'traits') === 'object' &&
    Reflect.get(value, 'capabilities') !== null &&
    typeof Reflect.get(value, 'capabilities') === 'object' &&
    Reflect.get(value, 'migrations') !== null &&
    typeof Reflect.get(value, 'migrations') === 'object' &&
    Reflect.get(value, 'introspector') !== null &&
    typeof Reflect.get(value, 'introspector') === 'object'
  );
}
