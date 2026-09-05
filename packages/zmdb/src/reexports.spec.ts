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
import {
  assert as srcAssert,
  assertShallow as srcAssertShallow,
  is as srcIs,
  isShallow as srcIsShallow,
  validate as srcValidate,
  validateShallow as srcValidateShallow,
} from '@zmdb/aot-validator/utilities';
import {
  DIALECT_PARAM_LIMITS as srcDIALECT_PARAM_LIMITS,
  OP_MAP as srcOP_MAP,
  QueryCompilerError as srcQueryCompilerError,
  UnsupportedFeatureError as srcUFE,
  chunkArray as srcChunkArray,
  coalesce as srcCoalesce,
  concat as srcConcat,
  createQueryCompiler as srcCreateQC,
  dec as srcDec,
  formatPlaceholder as srcFormatPlaceholder,
  inc as srcInc,
  mul as srcMul,
  not as srcNot,
  proposed as srcProposed,
  quoteColumn as srcQuoteColumn,
  quoteIdentifier as srcQuoteIdentifier,
  quoteTable as srcQuoteTable,
  renumberPlaceholders as srcRenumberPlaceholders,
  sanitizeKeys as srcSanitizeKeys,
} from '@zmdb/query-compiler';
import {
  down as srcDown,
  driverMigrationConnection as srcDMC,
  runCli as srcRunCli,
  status as srcStatus,
  up as srcUp,
} from '@zmdb/query-compiler/migrations';
import {
  BaseRepository as SrcBaseRepository,
  defineRepository as srcDefineRepository,
  IncompleteKeyError as SrcIncompleteKeyError,
  markTransactionClosed as srcMarkTransactionClosed,
} from '@zmdb/repository';
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
import {
  createStateUpdatePayload as srcCreateStateUpdatePayload,
  defineEntityStateMachine as srcDefineEntityStateMachine,
  defineStateTransitions as srcDefineStateTransitions,
  schemaOf as srcSchemaOf,
} from '@zmdb/schema-core';
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
import { describe, expect, it } from 'vitest';

import { decodeValue, defineType, encodeValue } from './custom-types.js';
import { sqliteDriver, type SqliteDatabase, type SqliteOptions, type SqliteStatement } from './drivers-sqlite.js';
import { EventBus, discriminatorFor, flattenEmbeddable, liftEmbeddable, rowToSubtype } from './entity-modeling.js';
import {
  assert,
  assertShallow,
  BaseRepository,
  coalesce,
  concat,
  createQueryCompiler,
  createStateUpdatePayload,
  dec,
  defineEntityStateMachine,
  defineRepository,
  defineStateTransitions,
  IncompleteKeyError,
  inc,
  is,
  isShallow,
  markTransactionClosed,
  migrations,
  mul,
  not,
  proposed,
  schemaOf,
  tags,
  UnsupportedFeatureError,
  validate,
  validateShallow,
} from './index.js';
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

describe('zmdb umbrella re-exports (#227)', () => {
  it('re-exports the curated schema-core surface, identical to source', () => {
    // Nine column builders and `defineSchema` used to be checked here. The declaration is a
    // type now, so what an umbrella install needs from schema-core at *runtime* is
    // `schemaOf<T>()` — and it needs the same one the transform recognises, which is what
    // identity asserts. The vocabulary itself is types, re-exported through `zmdb/tags` and
    // checked below for costing nothing.
    expect(schemaOf).toBe(srcSchemaOf);
    expect(defineStateTransitions).toBe(srcDefineStateTransitions);
    expect(defineEntityStateMachine).toBe(srcDefineEntityStateMachine);
    expect(createStateUpdatePayload).toBe(srcCreateStateUpdatePayload);
  });

  it('re-exports createQueryCompiler and UnsupportedFeatureError', () => {
    expect(createQueryCompiler).toBe(srcCreateQC);
    expect(UnsupportedFeatureError).toBe(srcUFE);
  });

  it('exports expression constructors from the umbrella package', () => {
    expect(inc).toBe(srcInc);
    expect(dec).toBe(srcDec);
    expect(mul).toBe(srcMul);
    expect(not).toBe(srcNot);
    expect(concat).toBe(srcConcat);
    expect(coalesce).toBe(srcCoalesce);
    expect(proposed).toBe(srcProposed);
  });

  it('exports the shallow validators from the umbrella package', () => {
    expect(is).toBe(srcIs);
    expect(isShallow).toBe(srcIsShallow);
    expect(assert).toBe(srcAssert);
    expect(assertShallow).toBe(srcAssertShallow);
    expect(validate).toBe(srcValidate);
    expect(validateShallow).toBe(srcValidateShallow);
    expect(tags).toBe(srcTags);
  });

  it('does not re-export the optional protobuf compiler calls', async () => {
    const product: Record<string, unknown> = await import('./index.js');
    expect(
      ['grpcDescriptor', 'loadGrpcService', 'protoDecode', 'protoDescriptor', 'protoEncode'].filter(
        name => name in product,
      ),
    ).toEqual([]);
  });

  it('re-exports the repository surface, including IncompleteKeyError', () => {
    expect(BaseRepository).toBe(SrcBaseRepository);
    expect(defineRepository).toBe(srcDefineRepository);
    expect(IncompleteKeyError).toBe(SrcIncompleteKeyError);
    expect(markTransactionClosed).toBe(srcMarkTransactionClosed);
  });

  it('re-exports unplugin zmdbAot via zmdb/unplugin', async () => {
    const unplugin = await import('./unplugin.js');
    expect(typeof unplugin.zmdbAot).toBe('function');
    await expect(unplugin.zmdbAot()).resolves.toMatchObject({ name: 'zmdb-aot', enforce: 'pre' });
  });
  it('re-exports migration runner under migrations namespace', () => {
    expect(migrations.up).toBe(srcUp);
    expect(migrations.down).toBe(srcDown);
    expect(migrations.status).toBe(srcStatus);
    expect(migrations.runCli).toBe(srcRunCli);
    expect(migrations.driverMigrationConnection).toBe(srcDMC);
  });

  it('re-exports the schema IR via zmdb/ir, identical to source', async () => {
    const [umbrella, source] = await Promise.all([import('./ir.js'), import('@zmdb/schema-core/ir')]);
    expect(umbrella.jsonSchemaFromIR).toBe(source.jsonSchemaFromIR);
    expect(umbrella.jsonSchemaForColumn).toBe(source.jsonSchemaForColumn);
    expect(umbrella.appTypeOf).toBe(source.appTypeOf);
    expect(umbrella.wireTypeOf).toBe(source.wireTypeOf);
    expect(umbrella.SQL_TYPES).toBe(source.SQL_TYPES);
    expect(umbrella.KNOWN_CONSTRAINT_KINDS).toBe(source.KNOWN_CONSTRAINT_KINDS);
    // The three back-ends and the shape they share. A consumer generating its own
    // artefacts needs the same entry points the built-in emitters use, or it ends up
    // re-deriving "which columns does a create have" — the fifth walker.
    expect(umbrella.schemaFromIR).toBe(source.schemaFromIR);
    expect(umbrella.shapeOfVariant).toBe(source.shapeOfVariant);
    expect(umbrella.jsonSchemaFromShape).toBe(source.jsonSchemaFromShape);
    expect(umbrella.objectTypeFromIR).toBe(source.objectTypeFromIR);
    expect(umbrella.objectTypeFromShape).toBe(source.objectTypeFromShape);
  });

  it('leaves nothing of the IR behind but the reflector bridge', async () => {
    // The umbrella enumerates every symbol rather than `export *`, which is what makes a
    // new back-end easy to forget. This is the check that it was not forgotten.
    //
    // `TAG_NAMES` is the exception and stays out: it maps an IR field to the *escaped
    // symbol name* the checker reports for a tag (`__@zmdbSerial@1`), which exists so the
    // reflection can match tags without importing a types-only module. Publishing it would
    // publish how reflection is implemented, and no consumer generating artefacts needs it.
    const [umbrella, source] = await Promise.all([import('./ir.js'), import('@zmdb/schema-core/ir')]);
    expect(Object.keys(source)).toContain('TAG_NAMES');
    expect(Object.keys(umbrella).toSorted()).toEqual(
      Object.keys(source)
        .filter(name => name !== 'TAG_NAMES')
        .toSorted(),
    );
  });

  it('re-exports the HTTP contract runtime and compiler from their explicit subpaths', async () => {
    const [runtime, runtimeSource, compiler, compilerSource] = await Promise.all([
      import('./web-contract.js'),
      import('@zmdb/web/contract'),
      import('./web-contract-compiler.js'),
      import('@zmdb/web/contract/compiler'),
    ]);
    expect(runtime.defineHttpContract).toBe(runtimeSource.defineHttpContract);
    expect(runtime.httpOperation).toBe(runtimeSource.httpOperation);
    expect(compiler.compileHttpContracts).toBe(compilerSource.compileHttpContracts);
    expect(compiler.generateHttpClient).toBe(compilerSource.generateHttpClient);
    expect(compiler.HTTP_CLIENT_GENERATOR_VERSION).toBe(compilerSource.HTTP_CLIENT_GENERATOR_VERSION);
  });

  it('exposes zmdb/tags and zmdb/derive with no runtime cost', async () => {
    // Both subpaths are type-only. Asserted here as well as in schema-core because
    // the umbrella is where a stray value re-export would actually reach a consumer's
    // bundle (REQ-TF-3).
    const tagsSubpath: Record<string, unknown> = await import('./tags.js');
    const deriveSubpath: Record<string, unknown> = await import('./derive.js');
    expect(Object.keys(tagsSubpath)).toEqual([]);
    expect(Object.keys(deriveSubpath)).toEqual([]);
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
