import { schemaFromIR, type SchemaIR } from '@zmdb/schema-core/ir';
import { describe, expect, it } from 'vitest';

import { makeSyntheticDialect, type FrozenDriver } from '../../query-compiler/src/testing/database-vertical.js';
import { defineRepository } from './index.js';

const WIDGET_IR: SchemaIR = {
  table: 'widgets',
  physicalTable: 'widgets',
  columns: [
    {
      name: 'id',
      physicalName: 'id',
      sql: 'integer',
      nullable: false,
      primaryKey: true,
      serial: false,
      unique: true,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
    },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

describe('database vertical repository boundary (#667)', () => {
  // Current measured behavior: defineRepository ignores driver.dialect, defaults to Postgres,
  // and emits `SELECT * FROM "widgets" WHERE "id" = $1 LIMIT 1`.
  it.fails('runs a third-party dialect through the generic repository boundary', async () => {
    const dialect = makeSyntheticDialect();
    const queries: string[] = [];
    const driver: FrozenDriver<'acme'> = {
      dialect,
      execute: query => {
        queries.push(query.text);
        return Promise.resolve([]);
      },
    };
    const defineExternalRepository = defineRepository as unknown as (
      schema: ReturnType<typeof schemaFromIR>,
      driver: FrozenDriver,
    ) => {
      findById(id: number): Promise<unknown>;
    };
    const repository = defineExternalRepository(schemaFromIR(WIDGET_IR), driver);

    await repository.findById(7);

    expect(queries).toEqual(['SELECT * FROM <widgets> WHERE <id> = $1 LIMIT 1']);
  });
});
