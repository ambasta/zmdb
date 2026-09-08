import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const directory = resolve(import.meta.dirname, '../../fixtures/runtime-foundation-hard-cut');
const owners = JSON.parse(readFileSync(resolve(directory, 'public-owners.json'), 'utf8')) as {
  bindings: readonly {
    from: string;
    name: string;
    to: string;
    export: string;
    value: boolean;
  }[];
};

// Resolve inside each test so an absent final package is the assertion's RED.
const load = (specifier: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ specifier);

describe('atomic runtime foundation public ownership (#638)', () => {
  for (const specifier of [...new Set(owners.bindings.map(binding => binding.to))].toSorted()) {
    it(`retains every frozen runtime binding at ${specifier}`, async () => {
      const module = await load(specifier);
      const expected = owners.bindings.filter(binding => binding.to === specifier && binding.value);
      for (const binding of expected) {
        expect(Object.hasOwn(module, binding.export), `${specifier}:${binding.export}`).toBe(true);
      }
    });
  }

  it('keeps SQL composition, validation errors and application transitions out of schema', async () => {
    const schema = await load('@zmdb/schema');
    for (const name of [
      'ValidationError',
      'claimsValidationIssues',
      'validationIssuesOf',
      'compileWhere',
      'applyOrderBy',
      'applyPagination',
      'applyKeysetFilter',
      'compilePopulate',
      'attachPopulated',
      'aliasRow',
      'defineStateTransitions',
      'createStateUpdatePayload',
      'defineEntityStateMachine',
    ])
      expect(Object.hasOwn(schema, name), name).toBe(false);
    const dto = await load('@zmdb/schema/dto');
    for (const name of ['compileWhere', 'applyOrderBy', 'applyPagination', 'applyKeysetFilter'])
      expect(Object.hasOwn(dto, name), name).toBe(false);
    const relations = await load('@zmdb/schema/relations');
    expect(Object.keys(relations).toSorted()).toEqual(['resolveRelation']);
  });

  it('uses one validation error constructor and distinct value and rule operations', async () => {
    const validator = await load('@zmdb/validator');
    const orm = await load('@zmdb/orm');
    const product = await load('zmdb');
    expect(orm.ValidationError).toBe(validator.ValidationError);
    expect(product.ValidationError).toBe(validator.ValidationError);
    expect(product.validate).toBe(validator.validate);
    expect(validator.validateRule).not.toBe(validator.validate);
  });

  it('keeps application bootstrap and configuration vocabulary on the product root', async () => {
    const product = await load('zmdb');
    const app = await load('@zmdb/app');
    const web = await load('@zmdb/web');
    const config = await load('zmdb/config');
    expect(product.createApp).toBe(web.createApp);
    expect(product.Controller).toBe(web.Controller);
    expect(product.Module).toBe(app.Module);
    expect(product.defineConfig).toBe(config.defineConfig);
  });

  it('keeps entity shape transformations separate from lifecycle execution', async () => {
    const schema = await load('@zmdb/schema/entity-modeling');
    const orm = await load('@zmdb/orm/entity-modeling');
    expect(Object.hasOwn(schema, 'EventBus')).toBe(false);
    for (const name of ['flattenEmbeddable', 'liftEmbeddable', 'discriminatorFor', 'rowToSubtype']) {
      expect(typeof schema[name]).toBe('function');
      expect(Object.hasOwn(orm, name)).toBe(false);
    }
    expect(typeof orm.EventBus).toBe('function');
  });

  it('refuses every deleted package and exported subpath', async () => {
    for (const specifier of new Set(owners.bindings.map(binding => binding.from))) {
      await expect(load(specifier), specifier).rejects.toThrow();
    }
    for (const specifier of ['@zmdb/validator/utilities', '@zmdb/sql/naming', '@zmdb/sql/outbox', '@zmdb/orm/query']) {
      await expect(load(specifier), specifier).rejects.toThrow();
    }
  });
});
