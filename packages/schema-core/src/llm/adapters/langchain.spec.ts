import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import { describe, expect, it, vi } from 'vitest';

import { ValidationError, type CoreSchema } from '../../index.js';
import type { JsonSchemaObject } from '../../openapi/index.js';
import type { Codec, PrimaryKey, Serial, Sql, Table, WireAs } from '../../tags/index.js';
import { toolFromSchema } from '../index.js';

const llmApi: object = await import('../index.js');

// Tests freeze for llm/adapters/SPEC.md (#526, epic #524).
//
// RED ON PURPOSE. `langchainTool` is absent at the tests-freeze baseline, so
// this file reaches it through one reflected, typed boundary. The model call is a structural stub:
// the real @langchain/core constructor compatibility is compiled separately in
// fixtures/llm-adapters.

interface Money {
  readonly cents: number;
}

type MoneyColumn = Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>;

export interface AdapterPayment extends Table<'adapter_payments'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  amount: MoneyColumn;
  memo: string & Sql<'text'>;
}

const { AdapterPayment: PaymentSchema } = schemasFrom(import.meta.url, ['AdapterPayment']);

interface ToolAdapterOptions<T> {
  readonly description: string;
  readonly validate: (value: unknown) => T;
  readonly execute: (input: T) => unknown | PromiseLike<unknown>;
}

interface LangChainToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchemaObject;
  readonly func: (input: unknown) => Promise<string>;
}

function callLangChainTool<T>(
  name: string,
  schema: CoreSchema<string>,
  opts: ToolAdapterOptions<T>,
): LangChainToolFields {
  const candidate: unknown = Reflect.get(llmApi, 'langchainTool');
  if (typeof candidate !== 'function') {
    throw new Error('#526 tests freeze: langchainTool is not exported from @zmdb/schema-core/llm');
  }
  return Reflect.apply(candidate, undefined, [name, schema, opts]) as LangChainToolFields;
}

interface PaymentInput {
  readonly amount: Money;
  readonly memo: string;
}

const decodePayment = (value: unknown): PaymentInput => {
  const input = Object(value);
  const amount: unknown = Reflect.get(input, 'amount');
  const memo: unknown = Reflect.get(input, 'memo');
  if (typeof amount !== 'string' || !/^\d+\.\d{2}$/.test(amount)) {
    throw new ValidationError('invalid tool arguments', [
      {
        path: '$input.amount',
        message: 'amount must be a decimal string',
        expected: 'decimal string',
        value: amount,
      },
    ]);
  }
  if (typeof memo !== 'string') {
    throw new ValidationError('invalid tool arguments', [
      { path: '$input.memo', message: 'memo must be a string', expected: 'string', value: memo },
    ]);
  }
  return { amount: { cents: Math.round(Number(amount) * 100) }, memo };
};

const invokeStubbedModel = (tool: LangChainToolFields, args: unknown): Promise<string> => tool.func(args);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const LLM_ENTRY = join(ROOT, 'packages/schema-core/src/llm/index.ts');

const resolveSource = (from: string, specifier: string): string | undefined => {
  const raw = resolve(dirname(from), specifier);
  const candidates = raw.endsWith('.js') ? [`${raw.slice(0, -3)}.ts`, raw] : [raw, `${raw}.ts`, join(raw, 'index.ts')];
  return candidates.find(candidate => existsSync(candidate));
};

const packageNameOf = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
};

const importSpecifiers = (source: string): readonly string[] => {
  const specifiers: string[] = [];
  const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticImport)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  for (const match of source.matchAll(dynamicImport)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
};

const externalImportsFrom = (entry: string): ReadonlySet<string> => {
  const pending = [entry];
  const visited = new Set<string>();
  const external = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith('.')) {
        external.add(packageNameOf(specifier));
        continue;
      }
      const resolved = resolveSource(file, specifier);
      if (resolved !== undefined) pending.push(resolved);
    }
  }

  return external;
};

const dependencyNames = (manifest: unknown, field: string): readonly string[] => {
  const value: unknown = Reflect.get(Object(manifest), field);
  return value !== null && typeof value === 'object' ? Object.keys(value) : [];
};

describe('LangChain tool adapter freeze (#526)', () => {
  it.fails('validates model arguments before the handler runs', async () => {
    const order: string[] = [];
    const handler = vi.fn((_input: PaymentInput): string => {
      order.push('handler');
      return 'created';
    });
    const tool = callLangChainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate(value) {
        order.push('validate');
        return decodePayment(value);
      },
      execute: handler,
    });

    const content = await invokeStubbedModel(tool, { amount: 42, memo: 'invoice' });

    expect(order).toStrictEqual(['validate']);
    expect(handler).not.toHaveBeenCalled();
    expect(content).toContain('$input.amount');
  });

  it.fails('reports a validation failure to the model as a tool error rather than throwing', async () => {
    const handler = vi.fn((_input: PaymentInput): string => 'created');
    const tool = callLangChainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute: handler,
    });

    const content = await invokeStubbedModel(tool, {
      amount: 'ORCHID-991403',
      memo: 'invoice',
    });

    expect(content).toContain('$input.amount');
    expect(content).toContain('decimal string');
    expect(content).not.toContain('ORCHID-991403');
    expect(content.toLowerCase()).not.toContain('orchid');
    expect(handler).not.toHaveBeenCalled();
  });

  it.fails('returns a non-string handler result as JSON text', async () => {
    const tool = callLangChainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute: input => ({ cents: input.amount.cents, memo: input.memo }),
    });

    await expect(invokeStubbedModel(tool, { amount: '19.99', memo: 'invoice' })).resolves.toBe(
      '{"cents":1999,"memo":"invoice"}',
    );
  });

  it.fails('rethrows a non-validation handler error unchanged', async () => {
    class RepositoryFailure extends Error {}
    const failure = new RepositoryFailure('database unavailable');
    const tool = callLangChainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute() {
        throw failure;
      },
    });

    await expect(invokeStubbedModel(tool, { amount: '19.99', memo: 'invoice' })).rejects.toBe(failure);
  });

  it.fails('uses the byte-identical json-schema document without a second producer', () => {
    const tool = callLangChainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute: input => input,
    });
    const generic = toolFromSchema('create_payment', PaymentSchema).parameters;

    expect(JSON.stringify(tool.schema)).toBe(JSON.stringify(generic));
  });

  it('does not import zod or any runtime schema library', () => {
    const imported = externalImportsFrom(LLM_ENTRY);
    for (const forbidden of [
      '@langchain/core',
      'ai',
      'zod',
      'json-schema-to-zod',
      'io-ts',
      'valibot',
      'yup',
      'joi',
      '@sinclair/typebox',
    ]) {
      expect(imported.has(forbidden), `${forbidden} is reachable from the shipped llm entry`).toBe(false);
    }
  });

  it('keeps framework packages out of schema-core dependency fields', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'packages/schema-core/package.json'), 'utf8'));
    const runtimeNames = new Set([
      ...dependencyNames(manifest, 'dependencies'),
      ...dependencyNames(manifest, 'peerDependencies'),
      ...dependencyNames(manifest, 'optionalDependencies'),
    ]);

    expect(runtimeNames.has('@langchain/core')).toBe(false);
    expect(runtimeNames.has('ai')).toBe(false);
    expect(runtimeNames.has('zod')).toBe(false);
    expect(runtimeNames.has('json-schema-to-zod')).toBe(false);
  });
});
