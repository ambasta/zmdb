import { schemasFrom } from '@zmdb/aot-validator/testing';
import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../index.js';
import type { Codec, PrimaryKey, Serial, Sql, Table, WireAs } from '../../tags/index.js';
import { toolFromSchema } from '../index.js';
import { aiSdkTool, type AiSdkToolFields } from './ai-sdk.js';

// Implementation suite for packages/ai-vercel/SPEC.md (#528, epic #524).

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

const invokeStubbedModel = async <Schema, Output>(
  fields: AiSdkToolFields<Schema, Output>,
  args: unknown,
): Promise<Output | string> => fields.execute(args);

const brandSchema = (schema: unknown): { readonly kind: 'ai-sdk-schema'; readonly schema: unknown } => ({
  kind: 'ai-sdk-schema',
  schema,
});

describe('Vercel AI SDK tool adapter (#528)', () => {
  it('validates AI SDK model arguments before the handler runs', async () => {
    const order: string[] = [];
    const handler = vi.fn((_input: InvoiceInput): string => {
      order.push('handler');
      return 'created';
    });
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate(value) {
        order.push('validate');
        return decodeInvoice(value);
      },
      execute: handler,
    });

    const content = await invokeStubbedModel(adapted, { amount: 42, memo: 'invoice' });

    expect(order).toStrictEqual(['validate']);
    expect(handler).not.toHaveBeenCalled();
    expect(String(content)).toContain('$input.amount');
  });

  it('reports an AI SDK validation failure as a tool result rather than throwing', async () => {
    const handler = vi.fn((_input: InvoiceInput): string => 'created');
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: handler,
    });

    const content = await invokeStubbedModel(adapted, {
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

  it('decodes validated arguments to the declared TypeScript type', async () => {
    const handler = vi.fn((input: InvoiceInput): number => input.amount.cents);
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: handler,
    });

    await expect(invokeStubbedModel(adapted, { amount: '19.99', memo: 'invoice' })).resolves.toBe(1999);
    expect(handler).toHaveBeenCalledWith({
      amount: { cents: 1999 },
      memo: 'invoice',
    });
  });

  it('rethrows a non-validation AI SDK handler error unchanged', async () => {
    class RepositoryFailure extends Error {}
    const failure = new RepositoryFailure('database unavailable');
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute() {
        throw failure;
      },
    });

    await expect(invokeStubbedModel(adapted, { amount: '19.99', memo: 'invoice' })).rejects.toBe(failure);
  });

  it('calls the injected jsonSchema exactly once with the generic document', () => {
    const jsonSchema = vi.fn(brandSchema);
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: input => input,
    });
    const generic = toolFromSchema('create_invoice', InvoiceSchema).parameters;

    expect(jsonSchema).toHaveBeenCalledOnce();
    expect(JSON.stringify(jsonSchema.mock.calls[0]?.[0])).toBe(JSON.stringify(generic));
    expect(adapted.inputSchema).toBe(jsonSchema.mock.results[0]?.value);
  });

  it('returns the SDK fields without inventing a name property', () => {
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: brandSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: input => input,
    });

    expect(adapted.description).toBe('Create an invoice');
    expect(adapted.inputSchema.kind).toBe('ai-sdk-schema');
    expect(Reflect.has(adapted, 'name')).toBe(false);
  });
});
