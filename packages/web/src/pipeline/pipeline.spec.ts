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

// Routes are bucketed by (method, segment count) rather than scanned flat, so
// these pin the two properties that bucketing could plausibly break: that
// declaration order still decides between two routes that both match, and that
// same-shape routes under different methods stay separate.
@Controller('/shadow')
class ShadowController {
  @Get('/:id')
  byId(ctx: Ctx<{ id: string }>) {
    return { via: 'param', id: ctx.params.id };
  }

  @Get('/me')
  me() {
    return { via: 'static' };
  }

  @Post('/:id')
  post(ctx: Ctx<{ id: string }>) {
    return { via: 'post', id: ctx.params.id };
  }
}

describe('@zmdb/web pipeline: route table', () => {
  it('lets the first-declared route win when two match', async () => {
    const router = createRouter();
    router.register(new ShadowController());
    // `/:id` is declared before `/me`, so it shadows it — as a flat scan did.
    const shadowed = await router.handle({ method: 'GET', path: '/shadow/me', headers: {} });
    expect(JSON.parse(shadowed.body)).toEqual({ via: 'param', id: 'me' });
  });

  it('keeps identically-shaped routes of different methods apart', async () => {
    const router = createRouter();
    router.register(new ShadowController());
    const get = await router.handle({ method: 'GET', path: '/shadow/7', headers: {} });
    const post = await router.handle({ method: 'POST', path: '/shadow/7', headers: {} });
    expect(JSON.parse(get.body)).toEqual({ via: 'param', id: '7' });
    expect(JSON.parse(post.body)).toEqual({ via: 'post', id: '7' });
  });

  it('404s a path whose segment count matches no route', async () => {
    const router = createRouter();
    router.register(new ShadowController());
    const deep = await router.handle({ method: 'GET', path: '/shadow/7/extra/more', headers: {} });
    expect(deep.status).toBe(404);
    const shallow = await router.handle({ method: 'GET', path: '/shadow', headers: {} });
    expect(shallow.status).toBe(404);
  });

  it('404s a known path under an unregistered method', async () => {
    const router = createRouter();
    router.register(new ShadowController());
    const del = await router.handle({ method: 'DELETE', path: '/shadow/7', headers: {} });
    expect(del.status).toBe(404);
  });
});

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
