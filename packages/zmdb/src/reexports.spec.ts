import { tags as srcTags } from '@zmdb/aot-validator';
import {
  is as srcIs,
  isShallow as srcIsShallow,
  assert as srcAssert,
  assertShallow as srcAssertShallow,
  validate as srcValidate,
  validateShallow as srcValidateShallow,
} from '@zmdb/aot-validator/utilities';
import {
  driverMigrationConnection as srcDMC,
  up as srcUp,
  down as srcDown,
  status as srcStatus,
  runCli as srcRunCli,
} from '@zmdb/migrations';
import {
  coalesce as srcCoalesce,
  concat as srcConcat,
  createQueryCompiler as srcQC,
  dec as srcDec,
  inc as srcInc,
  mul as srcMul,
  not as srcNot,
  proposed as srcProposed,
  UnsupportedFeatureError as srcUFE,
} from '@zmdb/query-compiler';
import {
  BaseRepository as SrcBaseRepository,
  defineRepository as srcDefineRepository,
  IncompleteKeyError as SrcIncompleteKeyError,
  markTransactionClosed as srcMarkTransactionClosed,
} from '@zmdb/repository';
import {
  schemaOf as srcSchemaOf,
  defineStateTransitions as srcDefineStateTransitions,
  defineEntityStateMachine as srcDefineEntityStateMachine,
  createStateUpdatePayload as srcCreateStateUpdatePayload,
} from '@zmdb/schema-core';
import { describe, expect, it } from 'vitest';

import {
  assert,
  assertShallow,
  BaseRepository,
  coalesce,
  concat,
  createQueryCompiler,
  dec,
  defineRepository,
  IncompleteKeyError,
  inc,
  is,
  isShallow,
  mul,
  not,
  proposed,
  schemaOf,
  tags,
  UnsupportedFeatureError,
  validate,
  validateShallow,
  defineStateTransitions,
  defineEntityStateMachine,
  createStateUpdatePayload,
  markTransactionClosed,
} from './index.js';

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
    expect(createQueryCompiler).toBe(srcQC);
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

  it('re-exports migration tooling from the explicit zmdb/migrations subpath', async () => {
    const migrations = await import('./migrations.js');
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
});
