import type { TemplateFactory } from './types.js';

export const repositoryTemplate: TemplateFactory = ({ name }) => ({
  files: [
    {
      path: `src/${name.fileStem}.repository.ts`,
      source: `import { defineRepository, schemaOf, type BaseRepository, type Driver } from 'zmdb';
import { repositoryToken, type ProviderDef } from 'zmdb/web';

import type { ${name.pascal} } from './${name.fileStem}.js';

const ${name.camel}Schema = schemaOf<${name.pascal}>();

export const ${name.constant}_REPOSITORY = repositoryToken<${name.pascal}>('${name.pascal}Repository');

export function ${name.camel}RepositoryProvider(driver: Driver): ProviderDef<BaseRepository<${name.pascal}>> {
  return {
    token: ${name.constant}_REPOSITORY,
    useFactory: () =>
      defineRepository(${name.camel}Schema, driver, {
        dialect: driver.dialect ?? 'sqlite',
      }),
  };
}
`,
    },
    {
      path: `src/${name.fileStem}.repository.spec.ts`,
      source: `import { DatabaseSync } from 'node:sqlite';

import { createTestApp } from '@zmdb/web/testing';
import { sqliteDriver } from 'zmdb/drivers/sqlite';
import { Module } from 'zmdb/web';
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
      const repository = app.get(${name.constant}_REPOSITORY);
      const created = await repository.create({ name: 'Ada' });
      expect(created.name).toBe('Ada');
      expect((await repository.findById(created.id))?.name).toBe('Ada');
      await app[Symbol.asyncDispose]();
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
