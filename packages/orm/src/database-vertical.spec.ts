// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { defineRepository } from '@zmdb/orm';
import { type TaggedSchema } from '@zmdb/schema';
import { schemaFromIR, type SchemaIR } from '@zmdb/schema/ir';
import { type PrimaryKey, type Sql, type Table } from '@zmdb/schema/tags';
import { describe, expect, it } from 'vitest';

import { makeSyntheticDialect, type FrozenDriver } from '../../sql/src/testing/database-vertical.js';
import { LOADER_ENTITY_BATCH } from './loaders/index.js';

interface Widget extends Table<'widgets'> {
  id: number & Sql<'integer'> & PrimaryKey;
}

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

const WIDGET_SCHEMA = schemaFromIR(WIDGET_IR) as TaggedSchema<Widget>;

describe('database vertical repository boundary (#668)', () => {
  it('runs a third-party dialect through the generic repository boundary', async () => {
    const dialect = makeSyntheticDialect();
    const queries: string[] = [];
    const driver: FrozenDriver<'acme'> = {
      dialect,
      execute: query => {
        queries.push(query.text);
        return Promise.resolve([]);
      },
    };
    const repository = defineRepository(WIDGET_SCHEMA, driver);

    await repository.findById(7);

    expect(queries).toEqual(['SELECT * FROM <widgets> WHERE <id> = $1 LIMIT 1']);
  });

  it('runs repository chunking from injected capabilities', async () => {
    const dialect = makeSyntheticDialect('acme-small', { paramLimit: 2 });
    const queries: string[] = [];
    const driver: FrozenDriver<'acme-small'> = {
      dialect,
      execute: query => {
        queries.push(query.text);
        return Promise.resolve(query.parameters.map(id => ({ id })));
      },
    };
    const repository = defineRepository(WIDGET_SCHEMA, driver);

    const rows = await repository[LOADER_ENTITY_BATCH]([1, 2, 3, 4, 5]);

    expect(queries).toEqual([
      'SELECT * FROM <widgets> WHERE <id> IN ($1, $2)',
      'SELECT * FROM <widgets> WHERE <id> IN ($1, $2)',
      'SELECT * FROM <widgets> WHERE <id> IN ($1)',
    ]);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
  });
});
