import { UnsupportedFeatureError } from '../errors.js';
import { MSSQL_TYPES, mssqlPaginate } from './mssql.js';

export const DIALECT_NAMES = ['postgres', 'mysql', 'sqlite', 'mssql'] as const;
export type Dialect = (typeof DIALECT_NAMES)[number];

export type PlaceholderStyle = 'numbered' | 'positional' | 'named';

export type DialectFeature =
  | 'materializedView'
  | 'rowLevelSecurity'
  | 'sequences'
  | 'schemas'
  | 'partialIndex'
  | 'generatedColumns'
  | 'transactionalDdl'
  | 'foreignKeys';

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

interface RequiredDialectTraits {
  readonly placeholder: PlaceholderStyle;
  readonly quote: readonly [open: string, close: string];
  readonly paginate: (tail: PaginationTail) => string;
  readonly returning: 'suffix' | 'output' | 'none';
  readonly upsert: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  readonly fts: 'tsvector' | 'match' | 'companionTable' | 'none';
  readonly concat: 'operator' | 'function';
  readonly booleanNot: 'not' | 'bitwise';
  readonly types: DialectTypeMap;
  readonly features: Readonly<Record<DialectFeature, boolean>>;
  readonly paramLimit: number;
  readonly retryableCodes: readonly string[];
}

interface DialectTraitOverrides {
  readonly placeholder?: PlaceholderStyle;
  readonly quote?: readonly [open: string, close: string];
  readonly paginate?: (tail: PaginationTail) => string;
  readonly returning?: 'suffix' | 'output' | 'none';
  readonly upsert?: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  readonly fts?: 'tsvector' | 'match' | 'companionTable' | 'none';
  readonly concat?: 'operator' | 'function';
  readonly booleanNot?: 'not' | 'bitwise';
  readonly types?: Readonly<Partial<DialectTypeMap>>;
  readonly features?: Readonly<Partial<Record<DialectFeature, boolean>>>;
  readonly paramLimit?: number;
  readonly retryableCodes?: readonly string[];
}

export type DialectTraits =
  | ({ readonly parent: Dialect } & DialectTraitOverrides)
  | ({
      readonly parent?: never;
      readonly types: DialectTypeMap;
      readonly features: Readonly<Record<DialectFeature, boolean>>;
    } & Omit<RequiredDialectTraits, 'types' | 'features'>);

export type ResolvedTraits = RequiredDialectTraits;

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
} satisfies DialectTypeMap);

export const DIALECTS: Readonly<Record<Dialect, DialectTraits>> = Object.freeze({
  postgres: Object.freeze({
    placeholder: 'numbered',
    quote: quotePair('"', '"'),
    paginate: standardPaginate,
    returning: 'suffix',
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
  }),
  mysql: Object.freeze({
    placeholder: 'positional',
    quote: quotePair('`', '`'),
    paginate: mysqlPaginate,
    returning: 'none',
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
  }),
  sqlite: Object.freeze({
    placeholder: 'positional',
    quote: quotePair('"', '"'),
    paginate: sqlitePaginate,
    returning: 'suffix',
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
  }),
  mssql: Object.freeze({
    placeholder: 'named',
    quote: quotePair('[', ']'),
    paginate: mssqlPaginate,
    returning: 'output',
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
  }),
});

function missingTrait(dialect: Dialect, trait: keyof RequiredDialectTraits): never {
  throw new Error(`Dialect "${dialect}" does not resolve required trait "${trait}"`);
}

function missingSqlType(dialect: Dialect, type: DialectSqlType): never {
  throw new Error(`Dialect "${dialect}" does not resolve SQL type "${type}"`);
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
  });
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
    placeholder: inherited(dialect, 'placeholder', definition.placeholder, parent?.placeholder),
    quote: quotePair(inheritedQuote[0], inheritedQuote[1]),
    paginate: inherited(dialect, 'paginate', definition.paginate, parent?.paginate),
    returning: inherited(dialect, 'returning', definition.returning, parent?.returning),
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

export function requireDialectFeature(dialect: Dialect, feature: DialectFeature, errorFeature: string): void {
  if (!TRAITS[dialect].features[feature]) {
    throw new UnsupportedFeatureError(errorFeature, dialect);
  }
}
