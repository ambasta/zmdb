import type { ToolSchema } from '@zmdb/ai';
import { jsonSchema, tool } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { aiSdkTool, type AiSdkToolFields } from './index.js';

interface InvoiceInput {
  readonly amount: { readonly cents: number };
  readonly memo: string;
}

class InputValidationError extends Error {
  constructor(
    readonly issues: readonly { readonly path: string; readonly message: string; readonly expected?: string }[],
  ) {
    super('invalid tool arguments');
  }
}

const textColumn = (name: string) => ({
  name,
  physicalName: name,
  sql: 'text' as const,
  nullable: false,
  primaryKey: false,
  serial: false,
  unique: false,
  hasDefault: false,
  sensitive: false,
  constraints: {},
  rules: [],
});

const InvoiceSchema = {
  table: 'adapter_invoices',
  columns: {
    amount: { type: 'text', flags: { nullable: false } },
    memo: { type: 'text', flags: { nullable: false } },
  },
  primaryKey: [],
  references: [],
  ir: {
    table: 'adapter_invoices',
    physicalTable: 'adapter_invoices',
    columns: [textColumn('amount'), textColumn('memo')],
    primaryKey: [],
    relations: [],
    foreignKeys: [],
  },
} satisfies ToolSchema;

const decodeInvoice = (value: unknown): InvoiceInput => {
  const input = Object(value);
  const amount: unknown = Reflect.get(input, 'amount');
  const memo: unknown = Reflect.get(input, 'memo');
  if (typeof amount !== 'string' || !/^\d+\.\d{2}$/.test(amount)) {
    throw new InputValidationError([
      {
        path: '$input.amount',
        message: 'amount must be a decimal string',
        expected: 'decimal string',
      },
    ]);
  }
  if (typeof memo !== 'string') {
    throw new InputValidationError([{ path: '$input.memo', message: 'memo must be a string', expected: 'string' }]);
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

describe('Vercel AI SDK tool adapter (#708)', () => {
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
    const jsonSchemaFactory = vi.fn(brandSchema);
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema: jsonSchemaFactory,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: input => input,
    });

    expect(jsonSchemaFactory).toHaveBeenCalledOnce();
    expect(adapted.inputSchema).toBe(jsonSchemaFactory.mock.results[0]?.value);
    expect(jsonSchemaFactory.mock.calls[0]?.[0]).toEqual({
      type: 'object',
      properties: {
        amount: { type: 'string' },
        memo: { type: 'string' },
      },
      required: ['amount', 'memo'],
    });
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

  it('real ai tool() accepts the returned fields', () => {
    const adapted = aiSdkTool('create_invoice', InvoiceSchema, {
      jsonSchema,
      description: 'Create an invoice',
      validate: decodeInvoice,
      execute: input => input.amount.cents,
    });

    const real = tool(adapted);

    expect(real.inputSchema).toBe(adapted.inputSchema);
    expect(real.execute).toBe(adapted.execute);
  });
});
