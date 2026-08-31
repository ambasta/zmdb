import { describe, it, expect } from 'vitest';

import { makeEndpoint } from './index.ts';

interface CreateUser {
  email: string;
}
const validate = (raw: unknown): CreateUser => {
  if (typeof raw !== 'object' || raw === null || typeof (raw as { email?: unknown }).email !== 'string') {
    throw new Error('invalid: email required');
  }
  return raw as CreateUser;
};

describe('framework integration contract (#154)', () => {
  it('valid input ⇒ 200 with serialized handler output', async () => {
    const ep = makeEndpoint<CreateUser, { id: number; email: string }>({
      validate,
      handle: async u => ({ id: 1, email: u.email }),
    });
    const res = await ep({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('invalid input ⇒ 400 and handler NOT called', async () => {
    let called = false;
    const ep = makeEndpoint<CreateUser, unknown>({
      validate,
      handle: async () => ((called = true), {}),
    });
    const res = await ep({ nope: true });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it('custom serialize is used', async () => {
    const ep = makeEndpoint<CreateUser, { email: string }>({
      validate,
      handle: async u => ({ email: u.email }),
      serialize: o => `email=${o.email}`,
    });
    const res = await ep({ email: 'x@y.com' });
    expect(res.body).toBe('email=x@y.com');
  });
});
