import { defineSqlDialect } from 'zmdb/sql';

function outsideJourney(): never {
  throw new Error('default consumer does not exercise migrations or introspection');
}

export const consumerDialect = defineSqlDialect({
  name: 'consumer-sqlite',
  family: 'sqlite',
  telemetrySystem: 'sqlite',
  traits: {
    placeholder: 'positional',
    quote: ['"', '"'],
    paginate: ({ limit, offset }) =>
      `${limit === undefined ? '' : ` LIMIT ${String(limit)}`}${offset === undefined ? '' : ` OFFSET ${String(offset)}`}`,
    paginationRequiresOrder: false,
    rowValueIn: true,
    returning: { insert: 'suffix', upsert: 'suffix', update: 'suffix', delete: 'suffix' },
    upsert: 'onConflict',
    fts: 'none',
    concat: 'operator',
    booleanNot: 'not',
    types: {
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
    },
    paramLimit: 100,
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
    transactionalDdl: true,
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
    name: 'consumer-sqlite',
    foreignKeyMode: 'inline',
    embedded: false,
    validateSnapshot: outsideJourney,
    validatePlan: outsideJourney,
    ddlType: outsideJourney,
    emitUp: outsideJourney,
    emitDown: outsideJourney,
    emitSchemaObject: outsideJourney,
    connection: outsideJourney,
  },
  introspector: {
    name: 'consumer-sqlite',
    snapshot: async () => outsideJourney(),
    normalizeForDrift: outsideJourney,
  },
});
