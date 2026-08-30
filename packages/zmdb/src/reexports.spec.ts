import { describe, it, expect } from 'vitest';
import * as zmdb from './index.ts';
import * as schemaCore from '@zmdb/schema-core';
import * as repository from '@zmdb/repository';
import { createQueryCompiler as srcQC } from '@zmdb/query-compiler';
import { is as srcIs, assert as srcAssert, validate as srcValidate } from '@zmdb/aot-validator/utilities';
import { tags as srcTags } from '@zmdb/aot-validator';

describe('zmdb umbrella re-exports (#227)', () => {
  it('re-exports the curated schema-core surface, identical to source', () => {
    for (const name of ['defineSchema', 'serial', 'integer', 'text', 'boolean', 'timestamp', 'jsonEnum', 'sensitive']) {
      expect((zmdb as Record<string, unknown>)[name], name).toBe((schemaCore as Record<string, unknown>)[name]);
    }
  });

  it('re-exports createQueryCompiler', () => {
    expect((zmdb as Record<string, unknown>).createQueryCompiler).toBe(srcQC);
  });

  it('re-exports validators is/assert/validate/tags', () => {
    const z = zmdb as Record<string, unknown>;
    expect(z.is).toBe(srcIs);
    expect(z.assert).toBe(srcAssert);
    expect(z.validate).toBe(srcValidate);
    expect(z.tags).toBe(srcTags);
  });

  it('re-exports the repository surface (BaseRepository, defineRepository)', () => {
    const z = zmdb as Record<string, unknown>;
    expect(z.BaseRepository).toBe((repository as Record<string, unknown>).BaseRepository);
    expect(z.defineRepository).toBe((repository as Record<string, unknown>).defineRepository);
  });
});
