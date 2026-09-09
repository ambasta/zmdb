import { Module as ownerModule } from '@zmdb/app/modules';
import {
  driverMigrationConnection as srcDMC,
  up as srcUp,
  down as srcDown,
  status as srcStatus,
} from '@zmdb/migrations';
import { defineRepository as ownerDefineRepository } from '@zmdb/orm';
import { schemaOf as ownerSchemaOf } from '@zmdb/schema';
import { assert as ownerAssert } from '@zmdb/validator';
import { createApp as ownerCreateApp } from '@zmdb/web/app';
import { Controller as ownerController } from '@zmdb/web/routing';
import { describe, expect, it } from 'vitest';

import { Controller, Module, assert, createApp, defineRepository, schemaOf } from './index.js';

describe('zmdb product re-exports (#227, #620)', () => {
  it('keeps the curated root values identical to their owners', () => {
    expect(schemaOf).toBe(ownerSchemaOf);
    expect(assert).toBe(ownerAssert);
    expect(defineRepository).toBe(ownerDefineRepository);
    expect(Module).toBe(ownerModule);
    expect(Controller).toBe(ownerController);
    expect(createApp).toBe(ownerCreateApp);
  });

  it('keeps advanced and optional names out of the root', async () => {
    const product: Readonly<Record<string, unknown>> = await import('./index.js');
    expect(
      [
        'BaseRepository',
        'createQueryCompiler',
        'migrations',
        'protoDecode',
        'protoDescriptor',
        'random',
        'tags',
        'toJsonSchema',
      ].filter(name => name in product),
    ).toEqual([]);
  });

  it('moves complete schema identities to zmdb/schema', async () => {
    const [facade, schema, ir, openapi] = await Promise.all([
      import('./schema.js'),
      import('@zmdb/schema'),
      import('@zmdb/schema/ir'),
      import('@zmdb/schema/openapi'),
    ]);
    expect(facade.schemaOf).toBe(schema.schemaOf);
    expect(facade.schemaFromIR).toBe(ir.schemaFromIR);
    expect(facade.toJsonSchema).toBe(openapi.toJsonSchema);
    expect(facade).not.toHaveProperty('TAG_NAMES');
  });

  it('moves SQL builders and DDL to zmdb/sql without internal helpers', async () => {
    const [facade, sql, schemaObjects] = await Promise.all([
      import('./sql.js'),
      import('@zmdb/sql'),
      import('@zmdb/sql/schema-objects'),
    ]);
    expect(facade.createQueryCompiler).toBe(sql.createQueryCompiler);
    expect(facade.createIndexDdl).toBe(schemaObjects.createIndexDdl);
    expect(facade).not.toHaveProperty('chunkArray');
    expect(facade).not.toHaveProperty('sanitizeKeys');
  });

  it('moves advanced validators and serialization to zmdb/validator', async () => {
    const [facade, utilities, serialization] = await Promise.all([
      import('./validator.js'),
      import('@zmdb/validator'),
      import('@zmdb/validator/serialization'),
    ]);
    expect(facade.random).toBe(utilities.random);
    expect(facade.validate).toBe(utilities.validate);
    expect(facade.stringify).toBe(serialization.stringify);
  });

  it('moves repositories, transactions, replicas, and outbox to zmdb/orm', async () => {
    const [facade, repository, replicas, outbox] = await Promise.all([
      import('./orm.js'),
      import('@zmdb/orm'),
      import('@zmdb/orm/replicas'),
      import('@zmdb/orm/outbox'),
    ]);
    expect(facade.BaseRepository).toBe(repository.BaseRepository);
    expect(facade.withReplicas).toBe(replicas.withReplicas);
    expect(facade.outboxWriter).toBe(outbox.outboxWriter);
  });

  it('re-exports migration tooling from the explicit zmdb/migrations subpath', async () => {
    const migrations = await import('./migrations.js');
    expect(migrations.up).toBe(srcUp);
    expect(migrations.down).toBe(srcDown);
    expect(migrations.status).toBe(srcStatus);
    expect(migrations).not.toHaveProperty('runCli');
    expect(migrations.driverMigrationConnection).toBe(srcDMC);
  });

  it('exposes compiler adapters from zmdb/compiler', async () => {
    const [facade, owner, transform] = await Promise.all([
      import('./compiler.js'),
      import('@zmdb/compiler'),
      import('@zmdb/compiler/transform'),
    ]);
    expect(facade.compileProject).toBe(owner.compileProject);
    expect(facade.writeCompileResult).toBe(owner.writeCompileResult);
    expect(facade.transformFile).toBe(transform.transformFile);
    expect(facade.zmdbAot).toBe(owner.zmdbAot);
  });

  it('exposes live and embedded migration runners from zmdb/migrations', async () => {
    const [facade, migrations, embedded] = await Promise.all([
      import('./migrations.js'),
      import('@zmdb/migrations'),
      import('@zmdb/migrations/embedded'),
    ]);
    expect(facade.up).toBe(migrations.up);
    expect(facade.runEmbedded).toBe(embedded.runEmbedded);
  });

  it('exposes package-boundary helpers from zmdb/testing', async () => {
    const [facade, compiler, web] = await Promise.all([
      import('./testing.js'),
      import('@zmdb/compiler/testing'),
      import('@zmdb/web/testing'),
    ]);
    expect(facade.schemasFrom).toBe(compiler.schemasFrom);
    expect(facade.createTestApp).toBe(web.createTestApp);
  });

  it('exposes configured compiler and HTTP contract subpaths', async () => {
    const [configuredCompiler, runtime, runtimeOwner, compiler, compilerOwner] = await Promise.all([
      import('@zmdb/compiler'),
      import('./web-contract.js'),
      import('@zmdb/web/contract'),
      import('./web-contract-compiler.js'),
      import('@zmdb/web/contract/compiler'),
    ]);
    await expect(configuredCompiler.zmdbAot()).resolves.toMatchObject({ name: 'zmdb-aot', enforce: 'pre' });
    expect(runtime.defineHttpContract).toBe(runtimeOwner.defineHttpContract);
    expect(compiler.compileHttpContracts).toBe(compilerOwner.compileHttpContracts);
  });

  it('keeps type-only compatibility subpaths empty at runtime', async () => {
    const [tags, derive] = await Promise.all([import('./tags.js'), import('./derive.js')]);
    expect(Object.keys(tags)).toEqual([]);
    expect(Object.keys(derive)).toEqual([]);
  });
});
