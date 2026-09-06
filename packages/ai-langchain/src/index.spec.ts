import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { toolFromSchema } from '@zmdb/ai';
import { schemasFrom } from '@zmdb/compiler/testing';
import { ValidationError } from '@zmdb/schema-core';
import type { Codec, PrimaryKey, Serial, Sql, Table, WireAs } from '@zmdb/schema-core/tags';
import { describe, expect, it, vi } from 'vitest';

import { langchainTool, type LangChainToolFields } from './index.js';

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

const invokeAdapter = (fields: LangChainToolFields, args: unknown): Promise<string> => fields.func(args);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER_ENTRIES = [
  join(ROOT, 'packages/ai-langchain/src/index.ts'),
  join(ROOT, 'packages/ai/src/tool-runtime.ts'),
];

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

const readManifest = (name: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8'));

const manifestField = (manifest: unknown, field: string): Readonly<Record<string, unknown>> => {
  const value: unknown = Reflect.get(Object(manifest), field);
  return value !== null && typeof value === 'object' ? Object(value) : {};
};

describe('@zmdb/ai-langchain', () => {
  it('validates model arguments before the handler runs', async () => {
    const order: string[] = [];
    const handler = vi.fn((_input: PaymentInput): string => {
      order.push('handler');
      return 'created';
    });
    const tool = new DynamicStructuredTool(
      langchainTool('create_payment', PaymentSchema, {
        description: 'Create a payment',
        validate(value) {
          order.push('validate');
          return decodePayment(value);
        },
        execute: handler,
      }),
    );

    const content = await tool.invoke({ amount: 'not-money', memo: 'invoice' });

    expect(order).toStrictEqual(['validate']);
    expect(handler).not.toHaveBeenCalled();
    expect(content).toContain('$input.amount');
  });

  it('reports a validation failure to the model as a tool error rather than throwing', async () => {
    const handler = vi.fn((_input: PaymentInput): string => 'created');
    const tool = langchainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute: handler,
    });

    const content = await invokeAdapter(tool, {
      amount: 'ORCHID-991403',
      memo: 'invoice',
    });

    expect(content).toContain('$input.amount');
    expect(content).toContain('decimal string');
    expect(content).not.toContain('ORCHID-991403');
    expect(content.toLowerCase()).not.toContain('orchid');
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses the byte-identical json-schema document without a second producer', () => {
    const tool = langchainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute: input => input,
    });
    const generic = toolFromSchema('create_payment', PaymentSchema).parameters;

    expect(JSON.stringify(tool.schema)).toBe(JSON.stringify(generic));
  });

  it('does not import zod or any runtime schema library', () => {
    const imported = new Set(ADAPTER_ENTRIES.flatMap(entry => [...externalImportsFrom(entry)]));
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
      expect(imported.has(forbidden), `${forbidden} is reachable from the shipped adapter`).toBe(false);
    }
  });

  it('real DynamicStructuredTool construction accepts the returned fields', async () => {
    const fields = langchainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute: input => ({ cents: input.amount.cents, memo: input.memo }),
    });
    const tool = new DynamicStructuredTool(fields);

    expect(tool.name).toBe('create_payment');
    expect(tool.schema).toBe(fields.schema);
    await expect(tool.invoke({ amount: '19.99', memo: 'invoice' })).resolves.toBe('{"cents":1999,"memo":"invoice"}');
  });

  it('returns a non-string handler result as JSON text exactly once', async () => {
    const tool = langchainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute: input => ({ nested: JSON.stringify({ cents: input.amount.cents }) }),
    });

    await expect(invokeAdapter(tool, { amount: '19.99', memo: 'invoice' })).resolves.toBe(
      '{"nested":"{\\"cents\\":1999}"}',
    );
  });

  it('rethrows a non-validation handler error unchanged', async () => {
    class RepositoryFailure extends Error {}
    const failure = new RepositoryFailure('database unavailable');
    const tool = langchainTool('create_payment', PaymentSchema, {
      description: 'Create a payment',
      validate: decodePayment,
      execute() {
        throw failure;
      },
    });

    await expect(invokeAdapter(tool, { amount: '19.99', memo: 'invoice' })).rejects.toBe(failure);
  });

  it('moves the LangChain peer out of schema-core and AI core manifests', () => {
    const schemaCore = readManifest('schema-core');
    const ai = readManifest('ai');
    const integration = readManifest('ai-langchain');

    for (const manifest of [schemaCore, ai]) {
      expect(manifestField(manifest, 'dependencies')).not.toHaveProperty('@langchain/core');
      expect(manifestField(manifest, 'peerDependencies')).not.toHaveProperty('@langchain/core');
      expect(manifestField(manifest, 'peerDependenciesMeta')).not.toHaveProperty('@langchain/core');
    }

    expect(manifestField(integration, 'dependencies')).toEqual({
      '@zmdb/ai': 'workspace:^',
    });
    expect(manifestField(integration, 'peerDependencies')).toEqual({ '@langchain/core': '^1.2.9' });
    expect(manifestField(integration, 'devDependencies')).toMatchObject({ '@langchain/core': '1.2.9' });
    expect(manifestField(integration, 'dependencies')).not.toHaveProperty('zod');
    expect(manifestField(integration, 'peerDependencies')).not.toHaveProperty('zod');
  });
});
