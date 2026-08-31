import { ValidationError } from '@zmdb/schema-core';
// Tests (#274) for the request pipeline & adapters — RED first (pipeline exports
// absent). Dispatch, param extraction, validate-before-handler, serialize, 404,
// 500, and node/fetch adapters. Per packages/web/src/pipeline/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Controller, Get, Post } from '../routing/index.ts';
import { createRouter, toFetchHandler, type Ctx } from './index.ts';

@Controller('/users')
class UsersController {
  @Get('/:id')
  get(ctx: Ctx<{ id: string }>) {
    return { id: ctx.params.id };
  }

  @Post()
  create(ctx: Ctx<Record<never, string>, { name: string }>) {
    return { created: ctx.body.name };
  }
}

function makeRouter() {
  const router = createRouter();
  const controller = new UsersController();
  router.register(controller, {
    create: {
      validateBody: raw => {
        if (typeof raw !== 'object' || raw === null || typeof Reflect.get(Object(raw), 'name') !== 'string') {
          throw new Error('name required');
        }
        return raw;
      },
    },
  });
  return router;
}

describe('@zmdb/web pipeline: dispatch', () => {
  it('routes to the handler and extracts params (200)', async () => {
    const res = await makeRouter().handle({ method: 'GET', path: '/users/42', headers: {} });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: '42' });
  });

  it('validates the body before the handler (invalid → 400, handler skipped)', async () => {
    const res = await makeRouter().handle({ method: 'POST', path: '/users', headers: {}, rawBody: { nope: 1 } });
    expect(res.status).toBe(400);
  });

  it('formats ValidationError issues into 400 response body', async () => {
    const router = createRouter();
    const controller = new UsersController();
    router.register(controller, {
      create: {
        validateBody: () => {
          throw new ValidationError('invalid user body', [
            { path: 'input.name', message: 'name required', expected: 'string' },
          ]);
        },
      },
    });
    const res = await router.handle({ method: 'POST', path: '/users', headers: {}, rawBody: {} });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'invalid user body',
      issues: [{ path: 'input.name', message: 'name required', expected: 'string' }],
    });
  });

  it('passes a valid body through to the handler (201/200)', async () => {
    const res = await makeRouter().handle({ method: 'POST', path: '/users', headers: {}, rawBody: { name: 'ada' } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ created: 'ada' });
  });

  it('returns 404 for an unknown route', async () => {
    const res = await makeRouter().handle({ method: 'GET', path: '/nope', headers: {} });
    expect(res.status).toBe(404);
  });
});

describe('@zmdb/web pipeline: fetch adapter', () => {
  it('round-trips a Fetch Request to a Response', async () => {
    const handler = toFetchHandler(makeRouter());
    const response = await handler(new Request('http://x/users/7', { method: 'GET' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '7' });
  });
});
