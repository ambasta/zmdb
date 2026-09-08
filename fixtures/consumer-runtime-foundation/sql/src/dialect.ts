import { defineSqlDialect, type SqlDialect } from '@zmdb/sql';

const unsupported = (): never => {
  throw new Error('The independent SQL consumer does not execute database migrations');
};

export const dialect: SqlDialect<'acme'> = defineSqlDialect({
  name: 'acme',
  family: 'acme',
  telemetrySystem: 'acme',
  traits: {
    placeholder: 'numbered',
    quote: ['<', '>'],
    paginate: tail =>
      `${tail.limit === undefined ? '' : ` LIMIT ${tail.limit}`}${tail.offset === undefined ? '' : ` OFFSET ${tail.offset}`}`,
    paginationRequiresOrder: false,
    rowValueIn: true,
    returning: { insert: 'suffix', upsert: 'suffix', update: 'suffix', delete: 'suffix' },
    upsert: 'onConflict',
    fts: 'none',
    concat: 'operator',
    booleanNot: 'not',
    types: {
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
    },
    paramLimit: 999,
    retryableCodes: [],
    acceptsOperator: operator => ['=', '!=', '<', '<=', '>', '>='].includes(operator),
    functions: false,
    procedures: false,
    tableFunctions: false,
    vectorDistance: false,
    spatialPredicates: false,
  },
  capabilities: {
    returning: { insert: true, upsert: true, update: true, delete: true },
    transactionalDdl: false,
    schemas: false,
    sequences: false,
    generatedColumns: false,
    partialIndexes: false,
    foreignKeys: false,
    rowLevelSecurity: false,
    streaming: false,
    cancellation: false,
  },
  migrations: {
    name: 'acme',
    foreignKeyMode: 'inline',
    embedded: false,
    validateSnapshot: unsupported,
    validatePlan: unsupported,
    ddlType: unsupported,
    emitUp: unsupported,
    emitDown: unsupported,
    emitSchemaObject: unsupported,
    connection: unsupported,
  },
  introspector: {
    name: 'acme',
    snapshot: unsupported,
    normalizeForDrift: unsupported,
  },
});
