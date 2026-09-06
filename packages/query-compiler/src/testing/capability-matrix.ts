export const OFFICIAL_DATABASES = ['sqlite', 'postgres', 'mysql', 'mssql', 'cockroach', 'singlestore'] as const;

export type OfficialDatabase = (typeof OFFICIAL_DATABASES)[number];

export const DATABASE_CAPABILITY_KEYS = [
  'returning.insert',
  'returning.upsert',
  'returning.update',
  'returning.delete',
  'transactionalDdl',
  'schemas',
  'sequences',
  'generatedColumns',
  'partialIndexes',
  'foreignKeys',
  'rowLevelSecurity',
  'streaming',
  'cancellation',
] as const;

export type DatabaseCapabilityKey = (typeof DATABASE_CAPABILITY_KEYS)[number];

export const SQL_TYPE_KEYS = [
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
  'uuid',
  'date',
  'time',
  'decimal',
  'blob',
] as const;

export type SqlTypeKey = (typeof SQL_TYPE_KEYS)[number];

export const VERTICAL_CONTRACT_KEYS = ['compiler', 'migration', 'introspection', 'repository'] as const;

export type VerticalContractKey = (typeof VERTICAL_CONTRACT_KEYS)[number];

export interface ExactExpectation {
  readonly kind: 'expectation';
  readonly value: string | number | boolean;
}

export interface ExplicitRefusal {
  readonly kind: 'refusal';
  readonly feature: string;
}

export type CapabilityEvidence = ExactExpectation | ExplicitRefusal;

export interface DatabaseCapabilityRow {
  readonly capabilities: Readonly<Record<DatabaseCapabilityKey, CapabilityEvidence>>;
  readonly sqlTypes: Readonly<Record<SqlTypeKey, ExactExpectation>>;
  readonly verticals: Readonly<Record<VerticalContractKey, ExactExpectation>>;
  readonly packedConsumer: `fixtures/database-${OfficialDatabase}`;
}

export type DatabaseCapabilityMatrix = Readonly<Record<OfficialDatabase, DatabaseCapabilityRow>>;

function expectation(value: string | number | boolean): ExactExpectation {
  return { kind: 'expectation', value };
}

function refusal(feature: string): ExplicitRefusal {
  return { kind: 'refusal', feature };
}

const POSTGRES_TYPES = {
  serial: expectation('SERIAL'),
  integer: expectation('INTEGER'),
  bigint: expectation('BIGINT'),
  numeric: expectation('NUMERIC'),
  text: expectation('TEXT'),
  varchar: expectation('VARCHAR'),
  boolean: expectation('BOOLEAN'),
  timestamp: expectation('TIMESTAMPTZ'),
  json: expectation('JSONB'),
  jsonEnum: expectation('TEXT'),
  uuid: expectation('uuid'),
  date: expectation('date'),
  time: expectation('time'),
  decimal: expectation('decimal'),
  blob: expectation('bytea'),
} satisfies DatabaseCapabilityRow['sqlTypes'];

const MYSQL_TYPES = {
  serial: expectation('INT AUTO_INCREMENT'),
  integer: expectation('INT'),
  bigint: expectation('BIGINT'),
  numeric: expectation('DECIMAL'),
  text: expectation('TEXT'),
  varchar: expectation('VARCHAR'),
  boolean: expectation('TINYINT(1)'),
  timestamp: expectation('DATETIME(3)'),
  json: expectation('JSON'),
  jsonEnum: expectation('TEXT'),
  uuid: expectation('char(36)'),
  date: expectation('date'),
  time: expectation('time'),
  decimal: expectation('decimal'),
  blob: expectation('blob'),
} satisfies DatabaseCapabilityRow['sqlTypes'];

const SQLITE_TYPES = {
  serial: expectation('INTEGER'),
  integer: expectation('INTEGER'),
  bigint: expectation('INTEGER'),
  numeric: expectation('NUMERIC'),
  text: expectation('TEXT'),
  varchar: expectation('TEXT'),
  boolean: expectation('INTEGER'),
  timestamp: expectation('TEXT'),
  json: expectation('TEXT'),
  jsonEnum: expectation('TEXT'),
  uuid: expectation('text'),
  date: expectation('date'),
  time: expectation('time'),
  decimal: expectation('decimal'),
  blob: expectation('blob'),
} satisfies DatabaseCapabilityRow['sqlTypes'];

const MSSQL_TYPES = {
  serial: expectation('INT IDENTITY(1,1)'),
  integer: expectation('INT'),
  bigint: expectation('BIGINT'),
  numeric: expectation('DECIMAL'),
  text: expectation('NVARCHAR(MAX)'),
  varchar: expectation('NVARCHAR'),
  boolean: expectation('BIT'),
  timestamp: expectation('DATETIMEOFFSET(3)'),
  json: expectation('NVARCHAR(MAX)'),
  jsonEnum: expectation('NVARCHAR(MAX)'),
  uuid: expectation('UNIQUEIDENTIFIER'),
  date: expectation('DATE'),
  time: expectation('TIME'),
  decimal: expectation('DECIMAL'),
  blob: expectation('VARBINARY(MAX)'),
} satisfies DatabaseCapabilityRow['sqlTypes'];

function completeVerticals(): DatabaseCapabilityRow['verticals'] {
  return {
    compiler: expectation('exact SQL or an explicit refusal'),
    migration: expectation('complete MigrationDialect implementation'),
    introspection: expectation('complete Introspector implementation'),
    repository: expectation('driver-bound generic repository execution'),
  };
}

const matrix = {
  sqlite: {
    capabilities: {
      'returning.insert': expectation('suffix'),
      'returning.upsert': expectation('suffix'),
      'returning.update': expectation('suffix'),
      'returning.delete': expectation('suffix'),
      transactionalDdl: expectation(true),
      schemas: refusal('schemas'),
      sequences: refusal('standalone sequences'),
      generatedColumns: expectation(true),
      partialIndexes: expectation(true),
      foreignKeys: expectation(true),
      rowLevelSecurity: refusal('row-level security'),
      streaming: expectation(true),
      cancellation: refusal('in-flight engine cancellation'),
    },
    sqlTypes: SQLITE_TYPES,
    verticals: completeVerticals(),
    packedConsumer: 'fixtures/database-sqlite',
  },
  postgres: {
    capabilities: {
      'returning.insert': expectation('suffix'),
      'returning.upsert': expectation('suffix'),
      'returning.update': expectation('suffix'),
      'returning.delete': expectation('suffix'),
      transactionalDdl: expectation(true),
      schemas: expectation(true),
      sequences: expectation(true),
      generatedColumns: expectation(true),
      partialIndexes: expectation(true),
      foreignKeys: expectation(true),
      rowLevelSecurity: expectation(true),
      streaming: expectation('cursor-capable queryable'),
      cancellation: expectation('configured second queryable'),
    },
    sqlTypes: POSTGRES_TYPES,
    verticals: completeVerticals(),
    packedConsumer: 'fixtures/database-postgres',
  },
  mysql: {
    capabilities: {
      'returning.insert': refusal('returning insert'),
      'returning.upsert': refusal('returning upsert'),
      'returning.update': refusal('returning update'),
      'returning.delete': refusal('returning delete'),
      transactionalDdl: refusal('transactional DDL'),
      schemas: expectation(true),
      sequences: refusal('standalone sequences'),
      generatedColumns: expectation(true),
      partialIndexes: refusal('partial indexes'),
      foreignKeys: expectation(true),
      rowLevelSecurity: refusal('row-level security'),
      streaming: refusal('streaming'),
      cancellation: refusal('in-flight cancellation'),
    },
    sqlTypes: MYSQL_TYPES,
    verticals: completeVerticals(),
    packedConsumer: 'fixtures/database-mysql',
  },
  mssql: {
    capabilities: {
      'returning.insert': expectation('output'),
      'returning.upsert': expectation('output'),
      'returning.update': expectation('output'),
      'returning.delete': expectation('output'),
      transactionalDdl: expectation(true),
      schemas: expectation(true),
      sequences: expectation(true),
      generatedColumns: expectation(true),
      partialIndexes: expectation(true),
      foreignKeys: expectation(true),
      rowLevelSecurity: refusal('row-level security'),
      streaming: refusal('streaming'),
      cancellation: refusal('in-flight cancellation'),
    },
    sqlTypes: MSSQL_TYPES,
    verticals: completeVerticals(),
    packedConsumer: 'fixtures/database-mssql',
  },
  cockroach: {
    capabilities: {
      'returning.insert': expectation('suffix'),
      'returning.upsert': expectation('suffix'),
      'returning.update': expectation('suffix'),
      'returning.delete': expectation('suffix'),
      transactionalDdl: refusal('transactional DDL'),
      schemas: expectation(true),
      sequences: expectation(true),
      generatedColumns: expectation(true),
      partialIndexes: expectation(true),
      foreignKeys: expectation(true),
      rowLevelSecurity: refusal('row-level security'),
      streaming: expectation('PostgreSQL-family cursor-capable queryable'),
      cancellation: refusal('server-side cancellation'),
    },
    sqlTypes: {
      ...POSTGRES_TYPES,
      serial: expectation('INT8 DEFAULT unique_rowid()'),
      integer: expectation('INT4'),
    },
    verticals: completeVerticals(),
    packedConsumer: 'fixtures/database-cockroach',
  },
  singlestore: {
    capabilities: {
      'returning.insert': refusal('returning insert'),
      'returning.upsert': refusal('returning upsert'),
      'returning.update': refusal('returning update'),
      'returning.delete': refusal('returning delete'),
      transactionalDdl: refusal('transactional DDL'),
      schemas: expectation(true),
      sequences: refusal('standalone sequences'),
      generatedColumns: expectation(true),
      partialIndexes: refusal('partial indexes'),
      foreignKeys: refusal('foreign keys'),
      rowLevelSecurity: refusal('row-level security'),
      streaming: refusal('streaming'),
      cancellation: refusal('in-flight cancellation'),
    },
    sqlTypes: {
      ...MYSQL_TYPES,
      serial: expectation('BIGINT AUTO_INCREMENT'),
      timestamp: expectation('DATETIME(6)'),
    },
    verticals: completeVerticals(),
    packedConsumer: 'fixtures/database-singlestore',
  },
} satisfies DatabaseCapabilityMatrix;

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key));
  }
  return Object.freeze(value);
}

export const DATABASE_CAPABILITY_MATRIX: DatabaseCapabilityMatrix = deepFreeze(matrix);

export const FAMILY_PARENTS = Object.freeze({
  cockroach: 'postgres',
  singlestore: 'mysql',
} as const satisfies Partial<Record<OfficialDatabase, OfficialDatabase>>);
