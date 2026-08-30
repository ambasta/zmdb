// Tests (#299) for DTO validation/serialization pipes — RED first (dto-pipes
// exports absent). Pipe rejects invalid, serializer emits, dtoChain composes.
// Per packages/web/src/dto-pipes/SPEC.md.
import { describe, it, expect } from 'vitest';
import { runChain } from '../middleware/index.ts';
import type { Ctx } from '../context/index.ts';
import { validationPipe, serializationInterceptor, dtoChain } from './index.ts';

interface CreateUser {
  name: string;
}
function assertCreateUser(raw: unknown): CreateUser {
  if (typeof raw !== 'object' || raw === null || typeof Reflect.get(raw, 'name') !== 'string') {
    throw new Error('name required');
  }
  return { name: Reflect.get(raw, 'name') };
}

function ctxWith(body: unknown): Ctx<Record<string, string>, unknown> {
  return { params: {}, body, query: {}, headers: {}, method: 'POST', path: '/' };
}

describe('@zmdb/web dto-pipes: validationPipe', () => {
  it('passes a valid body through (typed)', async () => {
    const chain = { guards: [], pipes: [validationPipe(assertCreateUser)], interceptors: [], filters: [] };
    const result = await runChain(chain, ctxWith({ name: 'ada' }), (ctx) => ctx.body);
    expect(result).toEqual({ name: 'ada' });
  });

  it('rejects an invalid body via the chain (400)', async () => {
    const chain = { guards: [], pipes: [validationPipe(assertCreateUser)], interceptors: [], filters: [] };
    await expect(runChain(chain, ctxWith({ nope: 1 }), (ctx) => ctx.body)).rejects.toMatchObject({ status: 400 });
  });
});

describe('@zmdb/web dto-pipes: serializationInterceptor', () => {
  it('serializes the handler result via the provided serializer', async () => {
    const chain = {
      guards: [],
      pipes: [],
      interceptors: [serializationInterceptor((v) => ({ wrapped: v }))],
      filters: [],
    };
    const result = await runChain(chain, ctxWith({}), () => ({ id: 1 }));
    expect(result).toEqual({ wrapped: { id: 1 } });
  });
});

describe('@zmdb/web dto-pipes: dtoChain', () => {
  it('composes validation + serialization', async () => {
    const chain = dtoChain({ validate: assertCreateUser, serialize: (v) => ({ data: v }) });
    const result = await runChain(chain, ctxWith({ name: 'grace' }), (ctx) => ctx.body);
    expect(result).toEqual({ data: { name: 'grace' } });
  });
});
