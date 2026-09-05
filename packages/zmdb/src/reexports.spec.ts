import { lenientParse as srcLenientParse, toolFromSchema as srcToolFromSchema } from '@zmdb/ai';
import {
  ValidationError as srcValidationError,
  getCachedRegExp as srcGetCachedRegExp,
  getEnumSet as srcGetEnumSet,
  getRegExp as srcGetRegExp,
  tags as srcTags,
  validate as srcValidateRoot,
  validatePatternComplexity as srcValidatePatternComplexity,
} from '@zmdb/aot-validator';
import {
  transformCode as srcUnpluginTransformCode,
  transformTypeChecks as srcUnpluginTransformTypeChecks,
  type UnpluginLike as SrcUnpluginLike,
} from '@zmdb/aot-validator/unplugin';
import { assert as ownerAssert } from '@zmdb/aot-validator/utilities';
import { Module as ownerModule } from '@zmdb/app/modules';
import {
  driverMigrationConnection as srcDMC,
  up as srcUp,
  down as srcDown,
  status as srcStatus,
  runCli as srcRunCli,
} from '@zmdb/migrations';
import {
  DIALECT_PARAM_LIMITS as srcDIALECT_PARAM_LIMITS,
  OP_MAP as srcOP_MAP,
  QueryCompilerError as srcQueryCompilerError,
  UnsupportedFeatureError as srcUFE,
  chunkArray as srcChunkArray,
  formatPlaceholder as srcFormatPlaceholder,
  createQueryCompiler as srcCreateQC,
  quoteColumn as srcQuoteColumn,
  quoteIdentifier as srcQuoteIdentifier,
  quoteTable as srcQuoteTable,
  renumberPlaceholders as srcRenumberPlaceholders,
  sanitizeKeys as srcSanitizeKeys,
} from '@zmdb/query-compiler';
import { defineRepository as ownerDefineRepository } from '@zmdb/repository';
import {
  EventBus as srcEventBus,
  discriminatorFor as srcDiscriminatorFor,
  flattenEmbeddable as srcFlattenEmbeddable,
  liftEmbeddable as srcLiftEmbeddable,
  rowToSubtype as srcRowToSubtype,
} from '@zmdb/repository/entity-modeling';
import { makeEndpoint as srcMakeEndpoint } from '@zmdb/repository/integrations';
import { isWrite as srcIsWrite, withReplicas as srcWithReplicas } from '@zmdb/repository/replicas';
import { makeRng as srcMakeRng, seedRows as srcSeedRows } from '@zmdb/repository/seeding';
import {
  batch as srcBatch,
  createTransactionalDb as srcCreateTransactionalDb,
  markTransactionClosed as srcMarkTransactionClosedTx,
} from '@zmdb/repository/transactions';
import { schemaOf as ownerSchemaOf } from '@zmdb/schema-core';
import {
  decodeValue as srcDecodeValue,
  defineType as srcDefineType,
  encodeValue as srcEncodeValue,
} from '@zmdb/schema-core/custom-types';
import {
  toJsonSchema as srcLLMToJsonSchema,
  toJsonSchema as srcToJsonSchema,
  toJsonSchemaWithRelations as srcToJsonSchemaWithRelations,
  toListSchema as srcToListSchema,
  toOpenApiComponents as srcToOpenApiComponents,
  toSearchSchema as srcToSearchSchema,
} from '@zmdb/schema-core/openapi';
import {
  sqliteDriver as srcSqliteDriver,
  type SqliteDatabase as SrcSqliteDatabase,
  type SqliteOptions as SrcSqliteOptions,
  type SqliteStatement as SrcSqliteStatement,
} from '@zmdb/sqlite';
import { createApp as ownerCreateApp } from '@zmdb/web/app';
import { Controller as ownerController } from '@zmdb/web/routing';
import { describe, expect, it } from 'vitest';

import { decodeValue, defineType, encodeValue } from './custom-types.js';
import { sqliteDriver, type SqliteDatabase, type SqliteOptions, type SqliteStatement } from './drivers-sqlite.js';
import { EventBus, discriminatorFor, flattenEmbeddable, liftEmbeddable, rowToSubtype } from './entity-modeling.js';
import { Controller, Module, assert, createApp, defineRepository, schemaOf } from './index.js';
import { makeEndpoint } from './integrations.js';
import { lenientParse, toJsonSchema as llmToJsonSchema, toolFromSchema } from './llm.js';
import {
  toJsonSchema,
  toJsonSchemaWithRelations,
  toListSchema,
  toOpenApiComponents,
  toSearchSchema,
} from './openapi.js';
import {
  DIALECT_PARAM_LIMITS,
  OP_MAP,
  QueryCompilerError,
  UnsupportedFeatureError as QueryUnsupportedFeatureError,
  chunkArray,
  createQueryCompiler as createQC,
  formatPlaceholder,
  quoteColumn,
  quoteIdentifier,
  quoteTable,
  renumberPlaceholders,
  sanitizeKeys,
} from './query.js';
import { isWrite, withReplicas } from './replicas.js';
import { makeRng, seedRows } from './seeding.js';
import { batch, createTransactionalDb, markTransactionClosed as markTxClosed } from './transactions.js';
import { transformCode as unpluginTransformCode, transformTypeChecks, zmdbAot, type UnpluginLike } from './unplugin.js';
import {
  ValidationError,
  getCachedRegExp,
  getEnumSet,
  getRegExp,
  tags as validatorTags,
  validate as validatorValidate,
  validatePatternComplexity,
} from './validator.js';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

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
      import('@zmdb/schema-core'),
      import('@zmdb/schema-core/ir'),
      import('@zmdb/schema-core/openapi'),
    ]);
    expect(facade.schemaOf).toBe(schema.schemaOf);
    expect(facade.schemaFromIR).toBe(ir.schemaFromIR);
    expect(facade.toJsonSchema).toBe(openapi.toJsonSchema);
    expect(facade).not.toHaveProperty('TAG_NAMES');
  });

  it('moves SQL builders and DDL to zmdb/sql without internal helpers', async () => {
    const [facade, sql, schemaObjects] = await Promise.all([
      import('./sql.js'),
      import('@zmdb/query-compiler'),
      import('@zmdb/query-compiler/schema-objects'),
    ]);
    expect(facade.createQueryCompiler).toBe(sql.createQueryCompiler);
    expect(facade.createIndexDdl).toBe(schemaObjects.createIndexDdl);
    expect(facade).not.toHaveProperty('chunkArray');
    expect(facade).not.toHaveProperty('sanitizeKeys');
  });

  it('moves advanced validators and serialization to zmdb/validator', async () => {
    const [facade, utilities, serialization] = await Promise.all([
      import('./validator.js'),
      import('@zmdb/aot-validator/utilities'),
      import('@zmdb/aot-validator/serialization'),
    ]);
    expect(facade.random).toBe(utilities.random);
    expect(facade.validate).toBe(utilities.validate);
    expect(facade.stringify).toBe(serialization.stringify);
  });

  it('moves repositories, transactions, replicas, and outbox to zmdb/orm', async () => {
    const [facade, repository, replicas, outbox] = await Promise.all([
      import('./orm.js'),
      import('@zmdb/repository'),
      import('@zmdb/repository/replicas'),
      import('@zmdb/repository/outbox'),
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
    expect(migrations.runCli).toBe(srcRunCli);
    expect(migrations.driverMigrationConnection).toBe(srcDMC);
  });

  it('exposes compiler adapters from zmdb/compiler', async () => {
    const [facade, owner, transform, productOwner] = await Promise.all([
      import('./compiler.js'),
      import('@zmdb/compiler'),
      import('@zmdb/compiler/transform'),
      import('./unplugin.js'),
    ]);
    expect(facade.compileProject).toBe(owner.compileProject);
    expect(facade.writeCompileResult).toBe(owner.writeCompileResult);
    expect(facade.transformFile).toBe(transform.transformFile);
    expect(facade.zmdbAot).toBe(productOwner.zmdbAot);
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

  it('retains release-governed compatibility and HTTP contract subpaths', async () => {
    const [unplugin, runtime, runtimeOwner, compiler, compilerOwner] = await Promise.all([
      import('./unplugin.js'),
      import('./web-contract.js'),
      import('@zmdb/web/contract'),
      import('./web-contract-compiler.js'),
      import('@zmdb/web/contract/compiler'),
    ]);
    await expect(unplugin.zmdbAot()).resolves.toMatchObject({ name: 'zmdb-aot', enforce: 'pre' });
    expect(runtime.defineHttpContract).toBe(runtimeOwner.defineHttpContract);
    expect(compiler.compileHttpContracts).toBe(compilerOwner.compileHttpContracts);
  });

  it('keeps type-only compatibility subpaths empty at runtime', async () => {
    const [tags, derive] = await Promise.all([import('./tags.js'), import('./derive.js')]);
    expect(Object.keys(tags)).toEqual([]);
    expect(Object.keys(derive)).toEqual([]);
  });

  it('re-exports sqlite driver subpath with values and types', () => {
    expect(sqliteDriver).toBe(srcSqliteDriver);
    type _T1 = Expect<Equal<SqliteDatabase, SrcSqliteDatabase>>;
    type _T2 = Expect<Equal<SqliteOptions, SrcSqliteOptions>>;
    type _T3 = Expect<Equal<SqliteStatement, SrcSqliteStatement>>;
    const _check: _T1 & _T2 & _T3 = true;
    expect(_check).toBe(true);
  });

  it('re-exports unplugin build plugin subpath (zmdbAot, transformTypeChecks, transformCode)', () => {
    expect(typeof zmdbAot).toBe('function');
    expect(transformTypeChecks).toBe(srcUnpluginTransformTypeChecks);
    expect(unpluginTransformCode).toBe(srcUnpluginTransformCode);
    type _T1 = Expect<Equal<UnpluginLike, SrcUnpluginLike>>;
    const _check: _T1 = true;
    expect(_check).toBe(true);
  });

  it('re-exports openapi subpath', () => {
    expect(toJsonSchema).toBe(srcToJsonSchema);
    expect(toJsonSchemaWithRelations).toBe(srcToJsonSchemaWithRelations);
    expect(toOpenApiComponents).toBe(srcToOpenApiComponents);
    expect(toListSchema).toBe(srcToListSchema);
    expect(toSearchSchema).toBe(srcToSearchSchema);
  });

  it('re-exports seeding subpath', () => {
    expect(makeRng).toBe(srcMakeRng);
    expect(seedRows).toBe(srcSeedRows);
  });

  it('re-exports custom-types subpath', () => {
    expect(defineType).toBe(srcDefineType);
    expect(encodeValue).toBe(srcEncodeValue);
    expect(decodeValue).toBe(srcDecodeValue);
  });

  it('re-exports llm subpath', () => {
    expect(toolFromSchema).toBe(srcToolFromSchema);
    expect(lenientParse).toBe(srcLenientParse);
    expect(llmToJsonSchema).toBe(srcLLMToJsonSchema);
  });

  it('re-exports transactions subpath', () => {
    expect(markTxClosed).toBe(srcMarkTransactionClosedTx);
    expect(createTransactionalDb).toBe(srcCreateTransactionalDb);
    expect(batch).toBe(srcBatch);
  });

  it('re-exports replicas subpath', () => {
    expect(isWrite).toBe(srcIsWrite);
    expect(withReplicas).toBe(srcWithReplicas);
  });

  it('re-exports integrations subpath', () => {
    expect(makeEndpoint).toBe(srcMakeEndpoint);
  });

  it('re-exports entity-modeling subpath', () => {
    expect(EventBus).toBe(srcEventBus);
    expect(flattenEmbeddable).toBe(srcFlattenEmbeddable);
    expect(liftEmbeddable).toBe(srcLiftEmbeddable);
    expect(discriminatorFor).toBe(srcDiscriminatorFor);
    expect(rowToSubtype).toBe(srcRowToSubtype);
  });

  it('re-exports query subpath', () => {
    expect(createQC).toBe(srcCreateQC);
    expect(QueryCompilerError).toBe(srcQueryCompilerError);
    expect(QueryUnsupportedFeatureError).toBe(srcUFE);
    expect(formatPlaceholder).toBe(srcFormatPlaceholder);
    expect(quoteColumn).toBe(srcQuoteColumn);
    expect(quoteIdentifier).toBe(srcQuoteIdentifier);
    expect(quoteTable).toBe(srcQuoteTable);
    expect(renumberPlaceholders).toBe(srcRenumberPlaceholders);
    expect(OP_MAP).toBe(srcOP_MAP);
    expect(DIALECT_PARAM_LIMITS).toBe(srcDIALECT_PARAM_LIMITS);
    expect(sanitizeKeys).toBe(srcSanitizeKeys);
    expect(chunkArray).toBe(srcChunkArray);
  });

  it('re-exports validator subpath', () => {
    expect(ValidationError).toBe(srcValidationError);
    expect(validatorTags).toBe(srcTags);
    expect(getRegExp).toBe(srcGetRegExp);
    expect(getEnumSet).toBe(srcGetEnumSet);
    expect(validatorValidate).toBe(srcValidateRoot);
    expect(validatePatternComplexity).toBe(srcValidatePatternComplexity);
    expect(getCachedRegExp).toBe(srcGetCachedRegExp);
  });
});
