import { tags as srcTags } from '@zmdb/aot-validator';
import { assert as srcAssert, is as srcIs, validate as srcValidate } from '@zmdb/aot-validator/utilities';
import { createQueryCompiler as srcQC } from '@zmdb/query-compiler';
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
  validate,
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

  it('re-exports createQueryCompiler', () => {
    expect(createQueryCompiler).toBe(srcQC);
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
});
