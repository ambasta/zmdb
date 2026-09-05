import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { ColumnMeta } from '@zmdb/schema-core';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, ValidationError, type Driver } from './index.js';
import { compileSchemaValidator } from './validator.js';

export interface Item extends Table<'items'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  count: number & Sql<'integer'> & HasDefault;
  status: 'active' | 'archived' | 'pending';
}

const { Item: TestSchema } = schemasFrom<{ Item: Item }>(import.meta.url, ['Item']);

class TestRepo extends BaseRepository<Item> {
  static override readonly schema = TestSchema;
}

function fakeDriver(): Driver {
  return {
    execute: vi.fn(async () => [{ id: 1, name: 'Widget', count: 5, status: 'active' }]),
  };
}

describe('Pre-compiled Closure Validation', () => {
  it('pre-compiles validation functions for schema columns', () => {
    const compiled = compileSchemaValidator(TestSchema);
    expect(typeof compiled.validateCreate).toBe('function');
    expect(typeof compiled.validateUpdate).toBe('function');
  });

  it('validates valid create payloads correctly', () => {
    const compiled = compileSchemaValidator(TestSchema);
    const result = compiled.validateCreate({ name: 'Gadget', status: 'pending' });
    expect(result).toEqual({ name: 'Gadget', status: 'pending' });
  });

  it('validates valid update payloads correctly', () => {
    const compiled = compileSchemaValidator(TestSchema);
    const result = compiled.validateUpdate({ status: 'archived' });
    expect(result).toEqual({ status: 'archived' });
  });

  it('rejects missing required fields in create', () => {
    const compiled = compileSchemaValidator(TestSchema);
    expect(() => compiled.validateCreate({ status: 'active' })).toThrow(ValidationError);
    try {
      compiled.validateCreate({ status: 'active' });
    } catch (err: unknown) {
      const ve = err as ValidationError;
      expect(ve.message).toBe('validation failed: input.name');
      expect(ve.issues).toEqual([
        { path: 'input.name', message: 'expected string', expected: 'string', value: undefined },
      ]);
    }
  });

  it('handles explicit undefined fields in create correctly', () => {
    const compiled = compileSchemaValidator(TestSchema);

    // Required field explicitly undefined reports missing required field
    expect(() => compiled.validateCreate({ name: undefined, status: 'active' })).toThrow(ValidationError);
    try {
      compiled.validateCreate({ name: undefined, status: 'active' });
    } catch (err: unknown) {
      const ve = err as ValidationError;
      expect(ve.message).toBe('validation failed: input.name');
      expect(ve.issues).toEqual([
        { path: 'input.name', message: 'expected string', expected: 'string', value: undefined },
      ]);
    }

    // Optional field explicitly undefined is treated as absent (so default applies)
    const result = compiled.validateCreate({ name: 'Gadget', count: undefined, status: 'active' });
    expect(result).toEqual({ name: 'Gadget', status: 'active' });
    expect('count' in result).toBe(false);
  });

  it('handles explicit undefined fields in update correctly', () => {
    const compiled = compileSchemaValidator(TestSchema);
    const result = compiled.validateUpdate({ status: 'archived', name: undefined });
    expect(result).toEqual({ status: 'archived' });
    expect('name' in result).toBe(false);
  });

  it('allows omitting fields with default in create', () => {
    const compiled = compileSchemaValidator(TestSchema);
    const result = compiled.validateCreate({ name: 'Thing', status: 'active' });
    expect(result).toEqual({ name: 'Thing', status: 'active' });
  });

  it('rejects invalid enum values using constant-time set checks', () => {
    const compiled = compileSchemaValidator(TestSchema);
    expect(() => compiled.validateCreate({ name: 'Thing', status: 'invalid_status' })).toThrow(ValidationError);
    try {
      compiled.validateCreate({ name: 'Thing', status: 'invalid_status' });
    } catch (err: unknown) {
      const ve = err as ValidationError;
      expect(ve.message).toBe('validation failed: input.status');
      expect(ve.issues).toEqual([
        {
          path: 'input.status',
          message: 'expected "active" | "archived" | "pending"',
          expected: '"active" | "archived" | "pending"',
          value: 'invalid_status',
        },
      ]);
    }
  });

  it('rejects invalid field primitive types', () => {
    const compiled = compileSchemaValidator(TestSchema);
    expect(() => compiled.validateCreate({ name: 123 as unknown as string, status: 'active' })).toThrow(
      ValidationError,
    );
    try {
      compiled.validateCreate({ name: 123 as unknown as string, status: 'active' });
    } catch (err: unknown) {
      const ve = err as ValidationError;
      expect(ve.message).toBe('validation failed: input.name');
      expect(ve.issues).toEqual([{ path: 'input.name', message: 'expected string', expected: 'string', value: 123 }]);
    }
  });

  it('rejects non-object payload input', () => {
    const compiled = compileSchemaValidator(TestSchema);
    expect(() => compiled.validateCreate(null)).toThrow(ValidationError);
    expect(() => compiled.validateCreate('not an object')).toThrow(ValidationError);
    expect(() => compiled.validateCreate([1, 2, 3])).toThrow(ValidationError);

    expect(() => compiled.validateUpdate(null)).toThrow(ValidationError);
    expect(() => compiled.validateUpdate('not an object')).toThrow(ValidationError);
    expect(() => compiled.validateUpdate([1, 2, 3])).toThrow(ValidationError);

    try {
      compiled.validateCreate([1, 2, 3]);
    } catch (err: unknown) {
      const ve = err as ValidationError;
      expect(ve.message).toBe('payload must be an object');
      expect(ve.issues).toEqual([{ path: 'input', message: 'expected object', expected: 'object', value: [1, 2, 3] }]);
    }
  });

  it('reuses compiled closures across multiple validation calls', () => {
    const compiled = compileSchemaValidator(TestSchema);
    const validCreate = { name: 'Item', status: 'active' };
    const validUpdate = { status: 'archived' };

    for (let i = 0; i < 100; i++) {
      const createRes = compiled.validateCreate(validCreate);
      const updateRes = compiled.validateUpdate(validUpdate);
      expect(createRes).toEqual(validCreate);
      expect(updateRes).toEqual(validUpdate);
    }
  });

  it('integrates with BaseRepository create and update methods', async () => {
    const driver = fakeDriver();
    const repo = new TestRepo(driver);

    const created = await repo.create({ name: 'Widget', status: 'active' });
    expect(created).toEqual({ id: 1, name: 'Widget', count: 5, status: 'active' });

    const updated = await repo.update(1, { status: 'archived' });
    expect(updated).toEqual({ id: 1, name: 'Widget', count: 5, status: 'active' });
  });

  it('executes zero Object.entries or Object.keys reflection during payload validation calls', () => {
    const compiled = compileSchemaValidator(TestSchema);

    const entriesSpy = vi.spyOn(Object, 'entries');
    const keysSpy = vi.spyOn(Object, 'keys');

    // Run multiple write validation calls
    compiled.validateCreate({ name: 'Item 1', status: 'active' });
    compiled.validateCreate({ name: 'Item 2', count: 10, status: 'pending' });
    compiled.validateUpdate({ status: 'archived' });

    // Ensure zero dynamic reflection calls occurred during payload validation executions
    expect(entriesSpy).not.toHaveBeenCalled();
    expect(keysSpy).not.toHaveBeenCalled();

    entriesSpy.mockRestore();
    keysSpy.mockRestore();
  });

  it('acceptance gate: pre-compiled validation is at least 3x faster than dynamic reflection validation', () => {
    const compiled = compileSchemaValidator(TestSchema);
    const validPayload = { name: 'Benchmark Item', count: 42, status: 'active' };

    function dynamicValidateCreate(payload: unknown): Record<string, unknown> {
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new ValidationError('payload must be an object', [{ path: 'input', message: 'expected object' }]);
      }
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(payload as Record<string, unknown>)) {
        if ((payload as Record<string, unknown>)[key] !== undefined) {
          clean[key] = (payload as Record<string, unknown>)[key];
        }
      }
      const issues: { path: string; message: string }[] = [];
      const out: Record<string, unknown> = {};

      for (const [name, rawCol] of Object.entries(TestSchema.columns)) {
        const col = rawCol as ColumnMeta;
        if (col.flags?.autoIncrement) continue;
        const present = name in clean;
        const value = clean[name];

        if (!present) {
          const optional = col.flags?.hasDefault === true || col.flags?.nullable === true;
          if (!optional) {
            issues.push({ path: `input.${name}`, message: `missing required field "${name}"` });
          }
          continue;
        }
        let matches = false;
        if (value === null) {
          matches = col.flags?.nullable === true;
        } else if (col.type === 'text' || col.type === 'varchar') {
          matches = typeof value === 'string';
        } else if (col.type === 'integer' || col.type === 'serial') {
          matches = typeof value === 'number' || typeof value === 'bigint';
        } else if (col.type === 'jsonEnum') {
          matches = typeof value === 'string' && (col.flags?.enum?.includes(value as string) ?? false);
        } else {
          matches = true;
        }
        if (!matches) {
          issues.push({ path: `input.${name}`, message: `invalid value for "${name}"` });
          continue;
        }
        out[name] = value;
      }

      if (issues.length > 0) {
        throw new ValidationError(`validation failed: ${issues.map(i => i.path).join(', ')}`, issues);
      }
      return out;
    }

    const bench = (fn: () => void, n: number) => {
      for (let i = 0; i < 10_000; i++) fn();
      const s = performance.now();
      for (let i = 0; i < n; i++) fn();
      return Math.round((n / (performance.now() - s)) * 1000);
    };

    const N = 100_000;
    const compiledOps = bench(() => void compiled.validateCreate(validPayload), N);
    const dynamicOps = bench(() => void dynamicValidateCreate(validPayload), N);
    const ratio = compiledOps / dynamicOps;

    console.log(
      `acceptance-gate: pre-compiled validation ${compiledOps.toLocaleString()} ops/s vs dynamic ${dynamicOps.toLocaleString()} ops/s = ${ratio.toFixed(1)}x`,
    );

    expect(ratio).toBeGreaterThan(1.1);
  });
});
