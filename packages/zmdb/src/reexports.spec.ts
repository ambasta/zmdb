import { tags as srcTags } from '@zmdb/aot-validator';
import { is as srcIs, assert as srcAssert, validate as srcValidate } from '@zmdb/aot-validator/utilities';
import { createQueryCompiler as srcQC, UnsupportedFeatureError as srcUFE } from '@zmdb/query-compiler';
import { BaseRepository as SrcBaseRepository, defineRepository as srcDefineRepository } from '@zmdb/repository';
import {
  defineSchema as srcDefineSchema,
  serial as srcSerial,
  integer as srcInteger,
  text as srcText,
  boolean as srcBoolean,
  timestamp as srcTimestamp,
  json as srcJson,
  jsonEnum as srcJsonEnum,
} from '@zmdb/schema-core';
import { describe, it, expect } from 'vitest';

import {
  defineSchema,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  json,
  jsonEnum,
  createQueryCompiler,
  UnsupportedFeatureError,
  is,
  assert,
  validate,
  tags,
  BaseRepository,
  defineRepository,
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
});
