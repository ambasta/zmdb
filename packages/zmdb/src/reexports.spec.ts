import { tags as srcTags } from '@zmdb/aot-validator';
import { is as srcIs, assert as srcAssert, validate as srcValidate } from '@zmdb/aot-validator/utilities';
import { createQueryCompiler as srcQC, UnsupportedFeatureError as srcUFE } from '@zmdb/query-compiler';
import {
  driverMigrationConnection as srcDMC,
  createMigrationConnection as srcCMC,
  driverAdapter as srcDA,
  up as srcUp,
  down as srcDown,
  status as srcStatus,
  runCli as srcRunCli,
} from '@zmdb/query-compiler/migrations';
import { BaseRepository as SrcBaseRepository, defineRepository as srcDefineRepository } from '@zmdb/repository';
import {
  boolean as srcBoolean,
  defineSchema as srcDefineSchema,
  integer as srcInteger,
  json as srcJson,
  jsonEnum as srcJsonEnum,
  sensitive as srcSensitive,
  serial as srcSerial,
  text as srcText,
  timestamp as srcTimestamp,
} from '@zmdb/schema-core';
import { describe, expect, it } from 'vitest';

import {
  assert,
  BaseRepository,
  boolean,
  createQueryCompiler,
  defineRepository,
  defineSchema,
  integer,
  is,
  json,
  jsonEnum,
  sensitive,
  serial,
  tags,
  text,
  timestamp,
  up,
  UnsupportedFeatureError,
  validate,
  down,
  status,
  runCli,
  driverMigrationConnection,
  createMigrationConnection,
  driverAdapter,
} from './index.ts';

describe('zmdb umbrella re-exports (#227)', () => {
  it('re-exports the curated schema-core surface, identical to source', () => {
    expect(defineSchema).toBe(srcDefineSchema);
    expect(serial).toBe(srcSerial);
    expect(integer).toBe(srcInteger);
    expect(text).toBe(srcText);
    expect(boolean).toBe(srcBoolean);
    expect(timestamp).toBe(srcTimestamp);
    expect(json).toBe(srcJson);
    expect(jsonEnum).toBe(srcJsonEnum);
    expect(sensitive).toBe(srcSensitive);
  });

  it('re-exports createQueryCompiler and UnsupportedFeatureError', () => {
    expect(createQueryCompiler).toBe(srcQC);
    expect(UnsupportedFeatureError).toBe(srcUFE);
  });

  it('re-exports validators is/assert/validate/tags', () => {
    expect(is).toBe(srcIs);
    expect(assert).toBe(srcAssert);
    expect(validate).toBe(srcValidate);
    expect(tags).toBe(srcTags);
  });

  it('re-exports the repository surface (BaseRepository, defineRepository)', () => {
    expect(BaseRepository).toBe(SrcBaseRepository);
    expect(defineRepository).toBe(srcDefineRepository);
  });

  it('re-exports unplugin zmdbAot via zmdb/unplugin', async () => {
    const unplugin = await import('./unplugin.ts');
    expect(typeof unplugin.zmdbAot).toBe('function');
  });

  it('re-exports migration runner and driver adapters', () => {
    expect(up).toBe(srcUp);
    expect(down).toBe(srcDown);
    expect(status).toBe(srcStatus);
    expect(runCli).toBe(srcRunCli);
    expect(driverMigrationConnection).toBe(srcDMC);
    expect(createMigrationConnection).toBe(srcCMC);
    expect(driverAdapter).toBe(srcDA);
  });
});
