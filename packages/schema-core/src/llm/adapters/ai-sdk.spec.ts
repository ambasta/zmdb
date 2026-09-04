import { schemasFrom } from '@zmdb/aot-validator/testing';
import { describe, expect, it, vi } from 'vitest';

import { ValidationError, type CoreSchema } from '../../index.js';
import type { Codec, PrimaryKey, Serial, Sql, Table, WireAs } from '../../tags/index.js';
import { toolFromSchema } from '../index.js';

const llmApi: object = await import('../index.js');

// Tests freeze for llm/adapters/SPEC.md (#526, epic #524).
//
// RED ON PURPOSE. `aiSdkTool` is absent at the tests-freeze baseline, so this
// file reaches it through one reflected, typed boundary. `invokeStubbedModel` exercises the
// framework-shaped object without importing the framework runtime; the real
// `tool()` compatibility is compiled in fixtures/llm-adapters.

interface Money {
  readonly cents: number;
}

type MoneyColumn = Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>;

export interface AdapterInvoice extends Table<'adapter_invoices'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  amount: MoneyColumn;
  memo: string & Sql<'text'>;
}

const { AdapterInvoice: InvoiceSchema } = schemasFrom(import.meta.url, ['AdapterInvoice']);

interface ToolAdapterOptions<T> {
  readonly description: string;
  readonly validate: (value: unknown) => T;
  readonly execute: (input: T) => unknown | PromiseLike<unknown>;
}

interface AiSdkToolFields<S> {
  readonly description: string;
  readonly inputSchema: S;
  readonly execute: (input: unknown) => Promise<unknown>;
}

function callAiSdkTool<T, S>(
  name: string,
  schema: CoreSchema<string>,
  opts: ToolAdapterOptions<T> & { readonly jsonSchema: (schema: unknown) => S },
): AiSdkToolFields<S> {
  const candidate: unknown = Reflect.get(llmApi, 'aiSdkTool');
  if (typeof candidate !== 'function') {
    throw new Error('#526 tests freeze: aiSdkTool is not exported from @zmdb/schema-core/llm');
  }
  return Reflect.apply(candidate, undefined, [name, schema, opts]) as AiSdkToolFields<S>;
}

interface InvoiceInput {
  readonly amount: Money;
  readonly memo: string;
}

const decodeInvoice = (value: unknown): InvoiceInput => {
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

const invokeStubbedModel = <S>(tool: AiSdkToolFields<S>, args: unknown): Promise<unknown> => tool.execute(args);

const brandSchema = (schema: unknown): { readonly kind: 'ai-sdk-schema'; readonly schema: unknown } => ({
  kind: 'ai-sdk-schema',
  schema,
});

describe('Vercel AI SDK tool adapter freeze (#526)', () => {
  it.fails('validates AI SDK model arguments before the handler runs', async () => {
    const order: string[] = [];
    const handler = vi.fn((_input: InvoiceInput): string => {
      order.push('handler');
      return 'created';
    });
    const tool = callAiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate(value) {
        order.push('validate');
        return decodeInvoice(value);
      },
      execute: handler,
    });

    const content = await invokeStubbedModel(tool, { amount: 42, memo: 'invoice' });

    expect(order).toStrictEqual(['validate']);
    expect(handler).not.toHaveBeenCalled();
    expect(String(content)).toContain('$input.amount');
  });

  it.fails('reports an AI SDK validation failure as a tool result rather than throwing', async () => {
    const handler = vi.fn((_input: InvoiceInput): string => 'created');
    const tool = callAiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: handler,
    });

    const content = await invokeStubbedModel(tool, {
      amount: 'ORCHID-991403',
      memo: 'invoice',
    });
    const text = String(content);

    expect(text).toContain('$input.amount');
    expect(text).toContain('decimal string');
    expect(text).not.toContain('ORCHID-991403');
    expect(text.toLowerCase()).not.toContain('orchid');
    expect(handler).not.toHaveBeenCalled();
  });

  it.fails('decodes validated arguments to the declared TypeScript type', async () => {
    const handler = vi.fn((input: InvoiceInput): number => input.amount.cents);
    const tool = callAiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: handler,
    });

    await expect(invokeStubbedModel(tool, { amount: '19.99', memo: 'invoice' })).resolves.toBe(1999);
    expect(handler).toHaveBeenCalledWith({
      amount: { cents: 1999 },
      memo: 'invoice',
    });
  });

  it.fails('rethrows a non-validation AI SDK handler error unchanged', async () => {
    class RepositoryFailure extends Error {}
    const failure = new RepositoryFailure('database unavailable');
    const tool = callAiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute() {
        throw failure;
      },
    });

    await expect(invokeStubbedModel(tool, { amount: '19.99', memo: 'invoice' })).rejects.toBe(failure);
  });

  it.fails('calls the injected jsonSchema exactly once with the generic document', () => {
    const jsonSchema = vi.fn(brandSchema);
    const tool = callAiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: input => input,
    });
    const generic = toolFromSchema('create_invoice', InvoiceSchema).parameters;

    expect(jsonSchema).toHaveBeenCalledOnce();
    expect(JSON.stringify(jsonSchema.mock.calls[0]?.[0])).toBe(JSON.stringify(generic));
    expect(tool.inputSchema).toBe(jsonSchema.mock.results[0]?.value);
  });

  it.fails('returns the SDK fields without inventing a name property', () => {
    const tool = callAiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: input => input,
    });

    expect(tool.description).toBe('Create an invoice');
    expect(tool.inputSchema.kind).toBe('ai-sdk-schema');
    expect(Reflect.has(tool, 'name')).toBe(false);
  });
});
