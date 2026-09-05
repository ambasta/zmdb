import { UnsupportedFeatureError } from '../errors.js';
import { MSSQL_TYPES, mssqlPaginate } from './mssql.js';
import {
  type DatabaseCapabilities,
  type DialectSqlType,
  type DialectTypeMap,
  type PaginationTail,
  type PlaceholderStyle,
  type ResolvedDialectTraits,
  type ReturningCapability,
  type ReturningStatement,
  type ReturningStyle,
  type SqlDialect,
} from './protocol.js';

export { defineSqlDialect, DIALECT_SQL_TYPES, extendSqlDialect, isSqlDialect } from './protocol.js';
export type {
  AppliedMigration,
  DatabaseCapabilities,
  DialectSqlType,
  DialectTypeMap,
  IntrospectionDriver,
  Introspector,
  IntrospectOptions,
  MigrationConnection,
  MigrationDialect,
  MigrationDriver,
  MigrationPlan,
  MigrationTableOptions,
  PaginationTail,
  PlaceholderStyle,
  ResolvedDialectTraits,
  ReturningCapability,
  ReturningStatement,
  ReturningStyle,
  SchemaObjectOperation,
  SqlDialect,
  SqlDialectDefinition,
  SqlDialectExtension,
} from './protocol.js';

export const DIALECT_NAMES = ['postgres', 'mysql', 'sqlite', 'mssql', 'cockroach', 'singlestore'] as const;
export type Dialect = (typeof DIALECT_NAMES)[number];
export type DialectFamily = Exclude<Dialect, 'cockroach' | 'singlestore'>;

export type DialectFeature =
  | 'materializedView'
  | 'rowLevelSecurity'
  | 'sequences'
  | 'schemas'
  | 'partialIndex'
  | 'generatedColumns'
  | 'transactionalDdl'
  | 'foreignKeys';

interface RequiredDialectTraits extends ResolvedDialectTraits {
  readonly features: Readonly<Record<DialectFeature, boolean>>;
}

interface DialectTraitOverrides {
  readonly placeholder?: PlaceholderStyle;
  readonly quote?: readonly [open: string, close: string];
  readonly paginate?: (tail: PaginationTail) => string;
  readonly returning?: Readonly<Partial<ReturningCapability>>;
  readonly upsert?: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  readonly fts?: 'tsvector' | 'match' | 'companionTable' | 'none';
  readonly concat?: 'operator' | 'function';
  readonly booleanNot?: 'not' | 'bitwise';
  readonly types?: Readonly<Partial<DialectTypeMap>>;
  readonly features?: Readonly<Partial<Record<DialectFeature, boolean>>>;
  readonly paramLimit?: number;
  readonly retryableCodes?: readonly string[];
  readonly acceptsOperator?: (operator: string) => boolean;
  readonly functions?: boolean;
  readonly procedures?: boolean;
  readonly tableFunctions?: boolean;
  readonly vectorDistance?: boolean;
  readonly spatialPredicates?: boolean;
}

export type DialectTraits =
  | ({ readonly parent: Dialect } & DialectTraitOverrides)
  | ({
      readonly parent?: never;
      readonly types: DialectTypeMap;
      readonly features: Readonly<Record<DialectFeature, boolean>>;
    } & Omit<RequiredDialectTraits, 'types' | 'features'>);

export type ResolvedTraits = RequiredDialectTraits & {
  /** The root dialect after the parent chain is resolved. */
  readonly family: DialectFamily;
};

/** Object-first target plus the temporary six-name compatibility surface removed by #675. */
export type DialectTarget<Name extends string = string> = SqlDialect<Name> | Dialect;

function standardPaginate({ limit, offset }: PaginationTail): string {
  let text = '';
  if (limit !== undefined) text += ` LIMIT ${limit}`;
  if (offset !== undefined) text += ` OFFSET ${offset}`;
  return text;
}

function mysqlPaginate({ limit, offset }: PaginationTail): string {
  if (limit === undefined && offset !== undefined) {
    return ` LIMIT 18446744073709551615 OFFSET ${offset}`;
  }
  return standardPaginate({
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ordered: false,
  });
}

function sqlitePaginate({ limit, offset }: PaginationTail): string {
  if (limit === undefined && offset !== undefined) return ` LIMIT -1 OFFSET ${offset}`;
  return standardPaginate({
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ordered: false,
  });
}

function quotePair(open: string, close: string): readonly [open: string, close: string] {
  return Object.freeze([open, close]);
}

const UNMAPPED_OPERATOR_TOKEN = /^(?!.*--)[A-Za-z@<>=!~*&|?-]{1,4}$/;

function operatorAcceptance(placeholder: PlaceholderStyle, hashOperators: boolean): (operator: string) => boolean {
  return (operator: string): boolean => {
    if (operator === '#>' || operator === '#>>') return hashOperators;
    if (!UNMAPPED_OPERATOR_TOKEN.test(operator)) return false;
    if (placeholder === 'positional' && operator.includes('?')) return false;
    if (placeholder === 'named' && operator.includes('@')) return false;
    return true;
  };
}

const POSTGRES_TYPES = Object.freeze({
  serial: 'SERIAL',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  numeric: 'NUMERIC',
  text: 'TEXT',
  varchar: 'VARCHAR',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMPTZ',
  json: 'JSONB',
  jsonEnum: 'TEXT',
  uuid: 'uuid',
  date: 'date',
  time: 'time',
  decimal: 'decimal',
  blob: 'bytea',
} satisfies DialectTypeMap);

const MYSQL_TYPES = Object.freeze({
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
  uuid: 'char(36)',
  date: 'date',
  time: 'time',
  decimal: 'decimal',
  blob: 'blob',
} satisfies DialectTypeMap);

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
  uuid: 'text',
  date: 'date',
  time: 'time',
  decimal: 'decimal',
  blob: 'blob',
} satisfies DialectTypeMap);

function returningCapability(style: ReturningStyle): ReturningCapability {
  return Object.freeze({
    insert: style,
    upsert: style,
    update: style,
    delete: style,
  });
}

const SUFFIX_RETURNING = returningCapability('suffix');
const OUTPUT_RETURNING = returningCapability('output');
const NO_RETURNING = returningCapability('none');

export const DIALECTS: Readonly<Record<Dialect, DialectTraits>> = Object.freeze({
  postgres: Object.freeze({
    placeholder: 'numbered',
    quote: quotePair('"', '"'),
    paginate: standardPaginate,
    returning: SUFFIX_RETURNING,
    upsert: 'onConflict',
    fts: 'tsvector',
    concat: 'operator',
    booleanNot: 'not',
    types: POSTGRES_TYPES,
    features: Object.freeze({
      materializedView: true,
      rowLevelSecurity: true,
      sequences: true,
      schemas: true,
      partialIndex: true,
      generatedColumns: true,
      transactionalDdl: true,
      foreignKeys: true,
    }),
    paramLimit: 60000,
    retryableCodes: Object.freeze(['40001', '40P01']),
    acceptsOperator: operatorAcceptance('numbered', true),
    functions: true,
    procedures: true,
    tableFunctions: true,
    vectorDistance: true,
    spatialPredicates: true,
  }),
  mysql: Object.freeze({
    placeholder: 'positional',
    quote: quotePair('`', '`'),
    paginate: mysqlPaginate,
    returning: NO_RETURNING,
    upsert: 'onDuplicateKey',
    fts: 'match',
    concat: 'function',
    booleanNot: 'not',
    types: MYSQL_TYPES,
    features: Object.freeze({
      materializedView: false,
      rowLevelSecurity: false,
      sequences: true,
      schemas: true,
      partialIndex: true,
      generatedColumns: true,
      transactionalDdl: false,
      foreignKeys: true,
    }),
    paramLimit: 60000,
    retryableCodes: Object.freeze([]),
    acceptsOperator: operatorAcceptance('positional', false),
    functions: true,
    procedures: true,
    tableFunctions: false,
    vectorDistance: false,
    spatialPredicates: false,
  }),
  sqlite: Object.freeze({
    placeholder: 'positional',
    quote: quotePair('"', '"'),
    paginate: sqlitePaginate,
    returning: SUFFIX_RETURNING,
    upsert: 'onConflict',
    fts: 'companionTable',
    concat: 'operator',
    booleanNot: 'not',
    types: SQLITE_TYPES,
    features: Object.freeze({
      materializedView: false,
      rowLevelSecurity: false,
      sequences: true,
      schemas: true,
      partialIndex: true,
      generatedColumns: true,
      transactionalDdl: true,
      foreignKeys: true,
    }),
    paramLimit: 30000,
    retryableCodes: Object.freeze([]),
    acceptsOperator: operatorAcceptance('positional', false),
    functions: false,
    procedures: false,
    tableFunctions: false,
    vectorDistance: false,
    spatialPredicates: false,
  }),
  mssql: Object.freeze({
    placeholder: 'named',
    quote: quotePair('[', ']'),
    paginate: mssqlPaginate,
    returning: OUTPUT_RETURNING,
    upsert: 'merge',
    fts: 'none',
    concat: 'function',
    booleanNot: 'bitwise',
    types: MSSQL_TYPES,
    features: Object.freeze({
      materializedView: false,
      rowLevelSecurity: false,
      sequences: true,
      schemas: true,
      partialIndex: true,
      generatedColumns: true,
      transactionalDdl: true,
      foreignKeys: true,
    }),
    paramLimit: 2000,
    retryableCodes: Object.freeze(['1205']),
    acceptsOperator: operatorAcceptance('named', false),
    functions: false,
    procedures: false,
    tableFunctions: false,
    vectorDistance: false,
    spatialPredicates: false,
  }),
  cockroach: Object.freeze({
    parent: 'postgres',
    types: Object.freeze({
      serial: 'INT8 DEFAULT unique_rowid()',
      integer: 'INT4',
    }),
    fts: 'none',
    features: Object.freeze({
      rowLevelSecurity: false,
    }),
    vectorDistance: false,
    spatialPredicates: false,
    retryableCodes: Object.freeze(['40001']),
  }),
  singlestore: Object.freeze({
    parent: 'mysql',
    types: Object.freeze({
      serial: 'BIGINT AUTO_INCREMENT',
    }),
    features: Object.freeze({
      foreignKeys: false,
    }),
  }),
});

function missingTrait(dialect: Dialect, trait: keyof RequiredDialectTraits): never {
  throw new Error(`Dialect "${dialect}" does not resolve required trait "${trait}"`);
}

function missingSqlType(dialect: Dialect, type: DialectSqlType): never {
  throw new Error(`Dialect "${dialect}" does not resolve SQL type "${type}"`);
}

function missingReturning(dialect: Dialect, statement: ReturningStatement): never {
  throw new Error(`Dialect "${dialect}" does not resolve RETURNING support for "${statement}"`);
}

function inherited<T>(
  dialect: Dialect,
  trait: keyof RequiredDialectTraits,
  own: T | undefined,
  parent: T | undefined,
): T {
  return own ?? parent ?? missingTrait(dialect, trait);
}

function resolveTypes(
  dialect: Dialect,
  own: Readonly<Partial<DialectTypeMap>> | undefined,
  parent: DialectTypeMap | undefined,
): DialectTypeMap {
  return Object.freeze({
    serial: own?.serial ?? parent?.serial ?? missingSqlType(dialect, 'serial'),
    integer: own?.integer ?? parent?.integer ?? missingSqlType(dialect, 'integer'),
    bigint: own?.bigint ?? parent?.bigint ?? missingSqlType(dialect, 'bigint'),
    numeric: own?.numeric ?? parent?.numeric ?? missingSqlType(dialect, 'numeric'),
    text: own?.text ?? parent?.text ?? missingSqlType(dialect, 'text'),
    varchar: own?.varchar ?? parent?.varchar ?? missingSqlType(dialect, 'varchar'),
    boolean: own?.boolean ?? parent?.boolean ?? missingSqlType(dialect, 'boolean'),
    timestamp: own?.timestamp ?? parent?.timestamp ?? missingSqlType(dialect, 'timestamp'),
    json: own?.json ?? parent?.json ?? missingSqlType(dialect, 'json'),
    jsonEnum: own?.jsonEnum ?? parent?.jsonEnum ?? missingSqlType(dialect, 'jsonEnum'),
    uuid: own?.uuid ?? parent?.uuid ?? missingSqlType(dialect, 'uuid'),
    date: own?.date ?? parent?.date ?? missingSqlType(dialect, 'date'),
    time: own?.time ?? parent?.time ?? missingSqlType(dialect, 'time'),
    decimal: own?.decimal ?? parent?.decimal ?? missingSqlType(dialect, 'decimal'),
    blob: own?.blob ?? parent?.blob ?? missingSqlType(dialect, 'blob'),
  });
}

function resolveReturning(
  dialect: Dialect,
  own: Readonly<Partial<ReturningCapability>> | undefined,
  parent: ReturningCapability | undefined,
): ReturningCapability {
  return Object.freeze({
    insert: own?.insert ?? parent?.insert ?? missingReturning(dialect, 'insert'),
    upsert: own?.upsert ?? parent?.upsert ?? missingReturning(dialect, 'upsert'),
    update: own?.update ?? parent?.update ?? missingReturning(dialect, 'update'),
    delete: own?.delete ?? parent?.delete ?? missingReturning(dialect, 'delete'),
  });
}

function rootFamily(dialect: Dialect): DialectFamily {
  if (dialect === 'cockroach' || dialect === 'singlestore') {
    throw new Error(`Dialect "${dialect}" declares no parent`);
  }
  return dialect;
}

function resolveOne(
  dialect: Dialect,
  definitions: Readonly<Record<Dialect, DialectTraits>>,
  cache: Map<Dialect, ResolvedTraits>,
  resolving: Set<Dialect>,
  onResolve?: () => void,
): ResolvedTraits {
  const cached = cache.get(dialect);
  if (cached !== undefined) return cached;
  if (resolving.has(dialect)) {
    throw new Error(`Dialect trait parent cycle includes "${dialect}"`);
  }

  resolving.add(dialect);
  const definition = definitions[dialect];
  const parent =
    definition.parent === undefined
      ? undefined
      : resolveOne(definition.parent, definitions, cache, resolving, onResolve);
  const inheritedQuote = inherited(dialect, 'quote', definition.quote, parent?.quote);
  const inheritedRetryableCodes = inherited(
    dialect,
    'retryableCodes',
    definition.retryableCodes,
    parent?.retryableCodes,
  );

  const resolved = Object.freeze({
    family: parent?.family ?? rootFamily(dialect),
    placeholder: inherited(dialect, 'placeholder', definition.placeholder, parent?.placeholder),
    quote: quotePair(inheritedQuote[0], inheritedQuote[1]),
    paginate: inherited(dialect, 'paginate', definition.paginate, parent?.paginate),
    returning: resolveReturning(dialect, definition.returning, parent?.returning),
    upsert: inherited(dialect, 'upsert', definition.upsert, parent?.upsert),
    fts: inherited(dialect, 'fts', definition.fts, parent?.fts),
    concat: inherited(dialect, 'concat', definition.concat, parent?.concat),
    booleanNot: inherited(dialect, 'booleanNot', definition.booleanNot, parent?.booleanNot),
    types: resolveTypes(dialect, definition.types, parent?.types),
    features: Object.freeze({
      materializedView: definition.features?.materializedView ?? parent?.features.materializedView ?? false,
      rowLevelSecurity: definition.features?.rowLevelSecurity ?? parent?.features.rowLevelSecurity ?? false,
      sequences: definition.features?.sequences ?? parent?.features.sequences ?? false,
      schemas: definition.features?.schemas ?? parent?.features.schemas ?? false,
      partialIndex: definition.features?.partialIndex ?? parent?.features.partialIndex ?? false,
      generatedColumns: definition.features?.generatedColumns ?? parent?.features.generatedColumns ?? false,
      transactionalDdl: definition.features?.transactionalDdl ?? parent?.features.transactionalDdl ?? false,
      foreignKeys: definition.features?.foreignKeys ?? parent?.features.foreignKeys ?? false,
    }),
    paramLimit: inherited(dialect, 'paramLimit', definition.paramLimit, parent?.paramLimit),
    retryableCodes: Object.freeze([...inheritedRetryableCodes]),
    acceptsOperator: inherited(dialect, 'acceptsOperator', definition.acceptsOperator, parent?.acceptsOperator),
    functions: inherited(dialect, 'functions', definition.functions, parent?.functions),
    procedures: inherited(dialect, 'procedures', definition.procedures, parent?.procedures),
    tableFunctions: inherited(dialect, 'tableFunctions', definition.tableFunctions, parent?.tableFunctions),
    vectorDistance: inherited(dialect, 'vectorDistance', definition.vectorDistance, parent?.vectorDistance),
    spatialPredicates: inherited(dialect, 'spatialPredicates', definition.spatialPredicates, parent?.spatialPredicates),
  } satisfies ResolvedTraits);

  resolving.delete(dialect);
  cache.set(dialect, resolved);
  onResolve?.();
  return resolved;
}

export function resolveDialectRegistry(
  definitions: Readonly<Record<Dialect, DialectTraits>>,
  onResolve?: () => void,
): Readonly<Record<Dialect, ResolvedTraits>> {
  const cache = new Map<Dialect, ResolvedTraits>();
  const resolving = new Set<Dialect>();
  return Object.freeze({
    postgres: resolveOne('postgres', definitions, cache, resolving, onResolve),
    mysql: resolveOne('mysql', definitions, cache, resolving, onResolve),
    sqlite: resolveOne('sqlite', definitions, cache, resolving, onResolve),
    mssql: resolveOne('mssql', definitions, cache, resolving, onResolve),
    cockroach: resolveOne('cockroach', definitions, cache, resolving, onResolve),
    singlestore: resolveOne('singlestore', definitions, cache, resolving, onResolve),
  });
}

let productionResolutionCount = 0;

export const TRAITS = resolveDialectRegistry(DIALECTS, () => {
  productionResolutionCount += 1;
});

/** Internal test seam: production resolution is complete before any statement can compile. */
export function dialectTraitResolutionCount(): number {
  return productionResolutionCount;
}

export function dialectName(dialect: DialectTarget): string {
  return typeof dialect === 'string' ? dialect : dialect.name;
}

export function dialectFamily(dialect: DialectTarget): string {
  return typeof dialect === 'string' ? TRAITS[dialect].family : dialect.family;
}

export function dialectTraits(dialect: DialectTarget): ResolvedDialectTraits {
  return typeof dialect === 'string' ? TRAITS[dialect] : dialect.traits;
}

export function dialectCapabilities(dialect: DialectTarget): DatabaseCapabilities {
  if (typeof dialect !== 'string') return dialect.capabilities;
  const traits = TRAITS[dialect];
  return Object.freeze({
    returning: Object.freeze({
      insert: traits.returning.insert !== 'none',
      upsert: traits.returning.upsert !== 'none',
      update: traits.returning.update !== 'none',
      delete: traits.returning.delete !== 'none',
    }),
    transactionalDdl: traits.features.transactionalDdl,
    schemas: traits.features.schemas,
    sequences: traits.features.sequences,
    generatedColumns: traits.features.generatedColumns,
    partialIndexes: traits.features.partialIndex,
    foreignKeys: traits.features.foreignKeys,
    rowLevelSecurity: traits.features.rowLevelSecurity,
    streaming: false,
    cancellation: false,
  });
}

export function dialectSupportsReturning(dialect: DialectTarget, statement: ReturningStatement): boolean {
  return dialectCapabilities(dialect).returning[statement];
}

function objectFeature(dialect: SqlDialect, feature: DialectFeature): boolean {
  switch (feature) {
    case 'rowLevelSecurity':
      return dialect.capabilities.rowLevelSecurity;
    case 'sequences':
      return dialect.capabilities.sequences;
    case 'schemas':
      return dialect.capabilities.schemas;
    case 'partialIndex':
      return dialect.capabilities.partialIndexes;
    case 'generatedColumns':
      return dialect.capabilities.generatedColumns;
    case 'transactionalDdl':
      return dialect.capabilities.transactionalDdl;
    case 'foreignKeys':
      return dialect.capabilities.foreignKeys;
    case 'materializedView':
      return false;
  }
}

export function requireDialectFeature(dialect: DialectTarget, feature: DialectFeature, errorFeature: string): void {
  const supported = typeof dialect === 'string' ? TRAITS[dialect].features[feature] : objectFeature(dialect, feature);
  if (!supported) {
    throw new UnsupportedFeatureError(errorFeature, dialectName(dialect));
  }
}
