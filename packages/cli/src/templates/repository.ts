// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { TemplateFactory } from './types.js';

export const repositoryTemplate: TemplateFactory = ({ name }) => ({
  files: [
    {
      path: `src/${name.fileStem}.repository.ts`,
      source: `import { defineRepository, schemaOf, type Driver } from '@zmdb/core';
import type { BaseRepository } from '@zmdb/core/orm';
import { repositoryToken } from '@zmdb/core/app/data';
import type { ProviderDef } from '@zmdb/core/app/modules';

import type { ${name.pascal} } from './${name.fileStem}.js';

const ${name.camel}Schema = schemaOf<${name.pascal}>();

export const ${name.constant}_REPOSITORY = repositoryToken<${name.pascal}>('${name.pascal}Repository');

export function ${name.camel}RepositoryProvider(driver: Driver): ProviderDef<BaseRepository<${name.pascal}>> {
  return {
    token: ${name.constant}_REPOSITORY,
    useFactory: () => defineRepository(${name.camel}Schema, driver),
  };
}
`,
    },
    {
      path: `src/${name.fileStem}.repository.spec.ts`,
      source: `import { DatabaseSync } from 'node:sqlite';

import { sqliteDriver } from '@zmdb/core/sqlite';
import { createTestApp } from '@zmdb/core/testing';
import { Module } from '@zmdb/core';
import { describe, expect, it } from 'vitest';

import {
  ${name.constant}_REPOSITORY,
  ${name.camel}RepositoryProvider,
} from './${name.fileStem}.repository.js';

describe('${name.pascal} repository provider', () => {
  it('creates and reads a row through sqlite', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        'CREATE TABLE "${name.table}" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL)',
      );

      @Module({ providers: [${name.camel}RepositoryProvider(sqliteDriver(database))] })
      class ${name.pascal}RepositoryTestModule {}

      const app = createTestApp(${name.pascal}RepositoryTestModule);
      try {
        const repository = app.get(${name.constant}_REPOSITORY);
        const created = await repository.create({ name: 'Ada' });
        expect(created.name).toBe('Ada');
        expect((await repository.findById(created.id))?.name).toBe('Ada');
      } finally {
        await app[Symbol.asyncDispose]?.();
      }
    } finally {
      database.close();
    }
  });
});
`,
    },
  ],
  instructions: [
    `add to src/app.module.ts, in @Module({ providers: [ … ] }):\n  ${name.camel}RepositoryProvider(driver),`,
  ],
});
