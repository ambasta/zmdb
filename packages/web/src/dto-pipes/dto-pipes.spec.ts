import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { Table, Sql, Serial, PrimaryKey, Sensitive } from '@zmdb/schema-core/tags';
// Tests (#299) for DTO validation/serialization pipes — RED first (dto-pipes
// exports absent). Pipe rejects invalid, serializer emits, dtoChain composes.
// Per packages/web/src/dto-pipes/SPEC.md.
import { describe, it, expect } from 'vitest';

import type { Ctx } from '../context/index.js';
import { runChain } from '../middleware/index.js';
import { validationPipe, serializationInterceptor, decodePipe, dtoChain } from './index.js';

export interface Profile extends Table<'profiles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  handle: string;
  ssn?: string & Sensitive;
}

const { Profile: ProfileSchema } = schemasFrom(import.meta.url, ['Profile']);

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
    const result = await runChain(chain, ctxWith({ name: 'ada' }), ctx => ctx.body);
    expect(result).toEqual({ name: 'ada' });
  });

  it('rejects an invalid body via the chain (400)', async () => {
    const chain = { guards: [], pipes: [validationPipe(assertCreateUser)], interceptors: [], filters: [] };
    await expect(runChain(chain, ctxWith({ nope: 1 }), ctx => ctx.body)).rejects.toMatchObject({ status: 400 });
  });
});

describe('@zmdb/web dto-pipes: serializationInterceptor', () => {
  it('serializes the handler result via the provided serializer', async () => {
    const chain = {
      guards: [],
      pipes: [],
      interceptors: [serializationInterceptor((v: unknown) => ({ wrapped: v }))],
      filters: [],
    };
    const result = await runChain(chain, ctxWith({}), () => ({ id: 1 }));
    expect(result).toEqual({ wrapped: { id: 1 } });
  });

  it('serializes the handler result via a schema fast stringifier', async () => {
    const chain = {
      guards: [],
      pipes: [],
      interceptors: [serializationInterceptor(ProfileSchema)],
      filters: [],
    };
    const result = await runChain(chain, ctxWith({}), () => ({ id: 5, handle: 'ada_l', ssn: '000-00-0000' }));
    expect(result).toBe('{"id":5,"handle":"ada_l"}');
  });
});

describe('@zmdb/web dto-pipes: dtoChain', () => {
  it('composes validation + serialization', async () => {
    const chain = dtoChain({ validate: assertCreateUser, serialize: (v: unknown) => ({ data: v }) });
    const result = await runChain(chain, ctxWith({ name: 'grace' }), ctx => ctx.body);
    expect(result).toEqual({ data: { name: 'grace' } });
  });

  it('composes validation + schema fast stringifier', async () => {
    const chain = dtoChain({ validate: assertCreateUser, schema: ProfileSchema });
    const result = await runChain(chain, ctxWith({ name: 'grace' }), () => ({
      id: 7,
      handle: 'grace_h',
      ssn: '111-11-1111',
    }));
    expect(result).toBe('{"id":7,"handle":"grace_h"}');
  });
});

// The wire→app decode as a pipe (plan D3): the two steps are separate and ordered,
// because a validator that accepted both layers' types would check neither.
interface CreateEvent {
  at: Date;
}
function assertCreateEvent(raw: unknown): CreateEvent {
  const at = Reflect.get(Object(raw), 'at');
  if (!(at instanceof Date)) throw new Error('expected Date');
  return { at };
}
function decodeAt(raw: unknown): unknown {
  const at = Reflect.get(Object(raw), 'at');
  return typeof at === 'string' ? { ...Object(raw), at: new Date(at) } : raw;
}

describe('@zmdb/web dto-pipes: decodePipe', () => {
  it('converts the body and asserts nothing', async () => {
    const chain = { guards: [], pipes: [decodePipe(decodeAt)], interceptors: [], filters: [] };
    const result = await runChain(chain, ctxWith({ at: '2026-01-01T12:30:00.000Z' }), ctx => ctx.body);
    expect(Reflect.get(Object(result), 'at')).toBeInstanceOf(Date);
  });
});

describe('@zmdb/web dto-pipes: dtoChain with a decode', () => {
  it('decodes before validating, so the ISO string a body carries reaches the handler as a Date', async () => {
    const chain = dtoChain({ decode: decodeAt, validate: assertCreateEvent });
    const result = await runChain(chain, ctxWith({ at: '2026-01-01T12:30:00.000Z' }), ctx => ctx.body);
    expect(result).toEqual({ at: new Date('2026-01-01T12:30:00.000Z') });
  });

  it('still reports what the decode could not convert, as a 400 from the validator', async () => {
    const chain = dtoChain({ decode: decodeAt, validate: assertCreateEvent });
    await expect(runChain(chain, ctxWith({ at: 12 }), ctx => ctx.body)).rejects.toMatchObject({ status: 400 });
  });

  it('leaves the single-pipe chain alone when no decode is given', () => {
    expect(dtoChain({ validate: assertCreateEvent }).pipes).toHaveLength(1);
    expect(dtoChain({ decode: decodeAt, validate: assertCreateEvent }).pipes).toHaveLength(2);
  });
});
