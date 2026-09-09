// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { StringDecoder } from 'node:string_decoder';

import { ValidationError } from '@zmdb/validator';
// Tests (#274) for the request pipeline & adapters — RED first (pipeline exports
// absent). Dispatch, param extraction, validate-before-handler, serialize, 404,
// 500, and node/fetch adapters. Per packages/web/src/pipeline/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Controller, Get, Post, UseGuards, UsePipes, UseInterceptors, UseFilters } from '../routing/index.js';
import {
  bodyText,
  createRouter,
  json,
  respond,
  text,
  toFetchHandler,
  toNodeHandler,
  type Ctx,
  type Router,
} from './index.js';

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
  it('preserves ordinary Fetch header records and mixed-case response headers', async () => {
    @Controller('/fetch-headers')
    class HeaderController {
      @Get()
      read(ctx: Ctx) {
        expect(Object.getPrototypeOf(ctx.headers)).toBe(Object.prototype);
        expect(Object.hasOwn(ctx.headers, '__proto__')).toBe(true);
        return respond({
          status: 200,
          body: JSON.stringify({ prototypeHeader: ctx.headers.__proto__, values: ctx.headers['x-values'] }),
          headers: { 'Content-Type': 'application/custom', 'Transfer-Encoding': 'chunked', 'X-Reply': 'yes' },
        });
      }
    }
    const router = createRouter();
    router.register(new HeaderController());
    const response = await toFetchHandler(router)(
      new Request('http://localhost/fetch-headers', {
        headers: [
          ['__proto__', 'ordinary-value'],
          ['X-Values', 'first'],
          ['x-values', 'second'],
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/custom');
    expect(response.headers.get('transfer-encoding')).toBeNull();
    expect(response.headers.get('x-reply')).toBe('yes');
    expect(await response.json()).toEqual({ prototypeHeader: 'ordinary-value', values: 'first, second' });
  });

  it.each([false, true])('shares loaders within each request (observability: %s)', async observed => {
    const scopes: unknown[] = [];
    const guarded = new WeakMap<object, unknown>();
    @Controller('/scopes')
    class ScopedController {
      @Get()
      read(ctx: Ctx) {
        const loaders = Reflect.get(ctx, 'loaders');
        expect(loaders).toBe(guarded.get(ctx));
        expect(loaders).toBeDefined();
        return 'ok';
      }
    }
    const router = createRouter(
      observed
        ? {
            meter: {
              counter: () => ({ add() {} }),
              histogram: () => ({ record() {} }),
            },
          }
        : {},
    );
    router.register(new ScopedController(), {
      read: {
        guards: [
          {
            canActivate: ctx => {
              scopes.push(Reflect.get(ctx, 'loaders'));
              guarded.set(ctx, Reflect.get(ctx, 'loaders'));
              return true;
            },
          },
        ],
      },
    });
    const handler = toFetchHandler(router);
    const responses = await Promise.all([
      handler(new Request('http://localhost/scopes')),
      handler(new Request('http://localhost/scopes')),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    expect(scopes[0]).toBeDefined();
    expect(scopes[0]).not.toBe(scopes[1]);
  });

  it('lets the first-declared route win when two match', async () => {
    const router = createRouter();
    router.register(new ShadowController());
    // `/:id` is declared before `/me`, so it shadows it — as a flat scan did.
    const shadowed = await router.handle({ method: 'GET', path: '/shadow/me', headers: {} });
    expect(JSON.parse(await bodyText(shadowed))).toEqual({ via: 'param', id: 'me' });
  });

  it('keeps identically-shaped routes of different methods apart', async () => {
    const router = createRouter();
    router.register(new ShadowController());
    const get = await router.handle({ method: 'GET', path: '/shadow/7', headers: {} });
    const post = await router.handle({ method: 'POST', path: '/shadow/7', headers: {} });
    expect(JSON.parse(await bodyText(get))).toEqual({ via: 'param', id: '7' });
    expect(JSON.parse(await bodyText(post))).toEqual({ via: 'post', id: '7' });
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
    expect(JSON.parse(await bodyText(res))).toEqual({ id: '42' });
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
    expect(JSON.parse(await bodyText(res))).toEqual({
      error: 'invalid user body',
      issues: [{ path: 'input.name', message: 'name required', expected: 'string' }],
    });
  });

  it('passes a valid body through to the handler (201/200)', async () => {
    const res = await makeRouter().handle({ method: 'POST', path: '/users', headers: {}, rawBody: { name: 'ada' } });
    expect(res.status).toBe(200);
    expect(JSON.parse(await bodyText(res))).toEqual({ created: 'ada' });
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

  it('carries a handler-chosen status, content type and body through', async () => {
    @Controller('/f')
    class FetchController {
      @Get('/t')
      t() {
        return text('plain', { status: 201, headers: { 'x-trace': 'abc' } });
      }
    }
    const router = createRouter();
    router.register(new FetchController());
    const response = await toFetchHandler(router)(new Request('http://x/f/t'));
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-trace')).toBe('abc');
    expect(await response.text()).toBe('plain');
  });
});

// Response control (json/text/respond). The pipeline used to wrap every handler
// result in `jsonResponse(200, result)`, so a handler could not pick a status,
// set a header, or return a body that was not JSON — which is why the framework
// benchmark harness hand-wrote its own node:http server instead of using the
// public router: the-benchmarker contract wants `GET /user/0` to answer with the
// three bytes `0`, and `JSON.stringify('0')` is `"0"` with quotes.
//
// The detection is a marker symbol, not a structural `'status' in result` check,
// and the first test here is the reason: returning a DTO that happens to have a
// `status` field is ordinary, and must keep meaning "this is my body".
@Controller('/r')
class ResponseController {
  @Get('/plain')
  plain() {
    return text('plain');
  }

  // The-benchmarker's own route spec: GET /user/0 must answer with the single
  // byte `0`. This is the case the old pipeline could not express.
  @Get('/echo/:id')
  echo(ctx: Ctx<{ id: string }>) {
    return text(ctx.params.id);
  }

  @Get('/empty')
  empty() {
    return text('');
  }

  @Get('/created')
  created() {
    return json({ ok: true }, { status: 201, headers: { location: '/r/1' } });
  }

  @Get('/redirect')
  redirect() {
    return respond({ status: 302, headers: { location: '/login' } });
  }

  @Get('/nocontent')
  nocontent() {
    return respond({ status: 204 });
  }

  @Get('/dto')
  dto() {
    // A perfectly ordinary payload that happens to have a `status` field.
    return { status: 'draft', body: 'hello', headers: { a: 'b' } };
  }
}

describe('@zmdb/web pipeline: response control', () => {
  const router = createRouter();
  router.register(new ResponseController());
  const get = (path: string) => router.handle({ method: 'GET', path, headers: {} });

  it('keeps a plain object as a 200 JSON body even when it has a status field', async () => {
    const res = await get('/r/dto');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(await bodyText(res))).toEqual({ status: 'draft', body: 'hello', headers: { a: 'b' } });
  });

  it('returns a text body verbatim, with no JSON quoting', async () => {
    const res = await get('/r/plain');
    expect(res.status).toBe(200);
    expect(await bodyText(res)).toBe('plain');
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it('answers a path parameter as raw bytes, not as a JSON string', async () => {
    const res = await get('/r/echo/0');
    expect(await bodyText(res)).toBe('0');
    expect(await bodyText(res)).not.toBe('"0"');
  });

  it('can answer with a genuinely empty body', async () => {
    const res = await get('/r/empty');
    expect(await bodyText(res)).toBe('');
  });

  it('honours an explicit status and merges extra headers over the JSON default', async () => {
    const res = await get('/r/created');
    expect(res.status).toBe(201);
    expect(res.headers).toEqual({ 'content-type': 'application/json', location: '/r/1' });
    expect(JSON.parse(await bodyText(res))).toEqual({ ok: true });
  });

  it('assumes no content type for respond(), so a redirect sends only what was asked', async () => {
    const res = await get('/r/redirect');
    expect(res.status).toBe(302);
    expect(res.headers).toEqual({ location: '/login' });
    expect(await bodyText(res)).toBe('');
  });

  it('sends a 204 with an empty body', async () => {
    const res = await get('/r/nocontent');
    expect(res.status).toBe(204);
    expect(await bodyText(res)).toBe('');
  });

  it('does not let one response’s headers leak into the next', async () => {
    // The JSON default is a shared module constant, so a factory that merged
    // into it rather than into a fresh object would corrupt every later response.
    await get('/r/created');
    const plain = await router.handle({ method: 'GET', path: '/users/1', headers: {} });
    expect(plain.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('keeps the marker off the enumerable surface', () => {
    // Existing consumers treat a WebResponse as a plain {status, body, headers}
    // record; the tag must be invisible to Object.keys, spreads and stringify.
    const res = text('x', { status: 200 });
    expect(Object.keys(res)).toEqual(['status', 'body', 'headers']);
    expect(JSON.parse(JSON.stringify(res))).toEqual({
      status: 200,
      body: { kind: 'text', value: 'x' },
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  });
});

// toNodeHandler had no tests at all, which is how it kept a body-decoding bug
// (String(chunk) per chunk corrupts a multi-byte character straddling a chunk
// boundary) and three avoidable per-request allocations. `FakeReq` models
// node:http closely enough to pin the behaviour that matters: it only emits
// 'data' when the framing headers say there is a body, and once setEncoding is
// called it decodes through a real StringDecoder exactly as IncomingMessage
// does, so a test can reproduce a split character.
class FakeReq {
  readonly listeners = new Map<string, (chunk: unknown) => void>();
  readonly socket?: { readonly encrypted?: boolean };
  private decoder: StringDecoder | undefined;

  constructor(
    readonly method: string,
    readonly url: string,
    readonly headers: Record<string, string | string[] | undefined> = {},
    socket?: { readonly encrypted?: boolean },
  ) {
    if (socket !== undefined) {
      this.socket = socket;
    }
  }

  on(event: string, listener: (chunk: unknown) => void): void {
    this.listeners.set(event, listener);
  }

  setEncoding(encoding: string): void {
    this.decoder = new StringDecoder(encoding as BufferEncoding);
  }

  /** Push body bytes, then end — what node:http does for a request with a body. */
  push(...chunks: Uint8Array[]): void {
    const data = this.listeners.get('data');
    for (const chunk of chunks) {
      data?.(this.decoder ? this.decoder.write(chunk) : chunk);
    }
    this.listeners.get('end')?.(undefined);
  }
}

function fakeRes(options: { writeHead: boolean }) {
  const state = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    done: undefined as Promise<void> | undefined,
  };
  let settle: () => void = () => undefined;
  state.done = new Promise<void>(resolve => {
    settle = resolve;
  });
  const res = {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value: number) {
      state.statusCode = value;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
    write() {
      return true;
    },
    once() {},
    destroy() {
      settle();
    },
    end(body?: string | Uint8Array<ArrayBuffer>) {
      state.body = typeof body === 'string' ? body : body === undefined ? undefined : new TextDecoder().decode(body);
      settle();
    },
    ...(options.writeHead
      ? {
          writeHead(status: number, headers: Readonly<Record<string, string>>) {
            state.statusCode = status;
            Object.assign(state.headers, headers);
          },
        }
      : {}),
  };
  return { res, state };
}

describe('@zmdb/web pipeline: node adapter', () => {
  it('dispatches a bodyless GET without registering data/end listeners', async () => {
    const req = new FakeReq('GET', '/users/7');
    const { res, state } = fakeRes({ writeHead: true });
    toNodeHandler(makeRouter())(req, res);
    await state.done;
    expect(req.listeners.size).toBe(0);
    expect(state.statusCode).toBe(200);
    expect(JSON.parse(state.body ?? '')).toEqual({ id: '7' });
  });

  it('strips the query string from the path', async () => {
    const req = new FakeReq('GET', '/users/7?expand=all&x=1');
    const { res, state } = fakeRes({ writeHead: true });
    toNodeHandler(makeRouter())(req, res);
    await state.done;
    expect(JSON.parse(state.body ?? '')).toEqual({ id: '7' });
  });

  it('maps the node socket transport to the request scheme', async () => {
    const schemes: (string | undefined)[] = [];
    const router: Router = {
      register: () => undefined,
      registerContract: () => undefined,
      registerDeferred: () => undefined,
      handle: request => {
        schemes.push(request.scheme);
        return Promise.resolve(json({ ok: true }));
      },
    };

    for (const request of [new FakeReq('GET', '/plain'), new FakeReq('GET', '/tls', {}, { encrypted: true })]) {
      const { res, state } = fakeRes({ writeHead: true });
      toNodeHandler(router)(request, res);
      await state.done;
    }

    expect(schemes).toEqual(['http', 'https']);
  });

  it('reads and validates a body when content-length says there is one', async () => {
    const raw = JSON.stringify({ name: 'ada' });
    const req = new FakeReq('POST', '/users', { 'content-length': String(raw.length) });
    const { res, state } = fakeRes({ writeHead: true });
    toNodeHandler(makeRouter())(req, res);
    req.push(new TextEncoder().encode(raw));
    await state.done;
    expect(state.statusCode).toBe(200);
    expect(JSON.parse(state.body ?? '')).toEqual({ created: 'ada' });
  });

  it('decodes a multi-byte character split across two chunks', async () => {
    // "ada✓" — U+2713 encodes as three bytes (E2 9C 93). Cut after the FIRST of
    // them, so each chunk on its own holds an incomplete sequence and decoding
    // them independently yields replacement characters. The assertion below
    // therefore only passes if the decoder carried the partial character over.
    const raw = new TextEncoder().encode(JSON.stringify({ name: 'ada✓' }));
    const cut = raw.indexOf(0xe2) + 1;
    expect(cut).toBeGreaterThan(0);
    expect(new TextDecoder().decode(raw.subarray(0, cut))).toContain('�');
    const req = new FakeReq('POST', '/users', { 'content-length': String(raw.length) });
    const { res, state } = fakeRes({ writeHead: true });
    toNodeHandler(makeRouter())(req, res);
    req.push(raw.subarray(0, cut), raw.subarray(cut));
    await state.done;
    expect(JSON.parse(state.body ?? '')).toEqual({ created: 'ada✓' });
  });

  it('treats content-length: 0 as no body', async () => {
    const req = new FakeReq('POST', '/users', { 'content-length': '0' });
    const { res, state } = fakeRes({ writeHead: true });
    toNodeHandler(makeRouter())(req, res);
    await state.done;
    expect(req.listeners.size).toBe(0);
    // No body means the validator rejects — a 400, not a hang.
    expect(state.statusCode).toBe(400);
  });

  it('reads a chunked body announced by transfer-encoding', async () => {
    const raw = JSON.stringify({ name: 'grace' });
    const req = new FakeReq('POST', '/users', { 'transfer-encoding': 'chunked' });
    const { res, state } = fakeRes({ writeHead: true });
    toNodeHandler(makeRouter())(req, res);
    req.push(new TextEncoder().encode(raw));
    await state.done;
    expect(JSON.parse(state.body ?? '')).toEqual({ created: 'grace' });
  });

  it('falls back to statusCode + setHeader when writeHead is absent', async () => {
    const req = new FakeReq('GET', '/users/7');
    const { res, state } = fakeRes({ writeHead: false });
    toNodeHandler(makeRouter())(req, res);
    await state.done;
    expect(state.statusCode).toBe(200);
    expect(state.headers['content-type']).toBe('application/json');
  });

  it('answers 500 instead of rejecting when handle throws', async () => {
    const exploding: Router = {
      register: () => undefined,
      registerContract: () => undefined,
      registerDeferred: () => undefined,
      handle: () => Promise.reject(new Error('boom')),
    };
    const req = new FakeReq('GET', '/users/7');
    const { res, state } = fakeRes({ writeHead: true });
    toNodeHandler(exploding)(req, res);
    await state.done;
    expect(state.statusCode).toBe(500);
    expect(JSON.parse(state.body ?? '')).toEqual({ error: 'boom' });
  });
});

describe('HTTP policy', () => {
  it.each([false, true])('decorates tagged responses and failures with observability %s', async observed => {
    @Controller('/policy')
    class PolicyController {
      @Get()
      get() {
        return text('unchanged', {
          headers: { Vary: 'Accept-Encoding, origin', 'X-Frame-Options': 'SAMEORIGIN', 'X-App': 'kept' },
        });
      }
      @Post()
      post() {
        throw new Error('failure');
      }
    }
    const router = createRouter({
      policy: {
        cors: { origins: ['https://allowed'], credentials: true },
        securityHeaders: { 'X-Frame-Options': 'DENY', 'X-App': false },
      },
      ...(observed ? { meter: { counter: () => ({ add() {} }), histogram: () => ({ record() {} }) } } : {}),
    });
    router.register(new PolicyController());
    const response = await router.handle({ method: 'GET', path: '/policy', headers: { origin: 'https://allowed' } });
    expect(await bodyText(response)).toBe('unchanged');
    const headers = new Headers(response.headers);
    expect(headers.get('access-control-allow-origin')).toBe('https://allowed');
    expect(headers.get('access-control-allow-credentials')).toBe('true');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-app')).toBe('kept');
    expect(
      headers
        .get('vary')
        ?.toLowerCase()
        .split(',')
        .map(v => v.trim()),
    ).toEqual(['accept-encoding', 'origin']);
    const failed = await router.handle({ method: 'POST', path: '/policy', headers: { origin: 'https://denied' } });
    expect(failed.status).toBe(500);
    expect(new Headers(failed.headers).has('access-control-allow-origin')).toBe(false);
    expect(new Headers(failed.headers).get('x-frame-options')).toBe('DENY');
  });

  it('rejects credentialed wildcard and invalid fixed headers at setup and calls origin predicates once', async () => {
    expect(() => createRouter({ policy: { cors: { origins: '*', credentials: true } } })).toThrow();
    expect(() => createRouter({ policy: { securityHeaders: { 'bad name': 'value' } } })).toThrow();
    expect(() => createRouter({ policy: { securityHeaders: { 'x-header': 'bad\nvalue' } } })).toThrow();
    let calls = 0;
    const router = createRouter({
      policy: {
        cors: {
          origins: origin => {
            calls += 1;
            return origin === 'https://allowed';
          },
        },
      },
    });
    const response = await toFetchHandler(router)(
      new Request('http://x/', {
        method: 'OPTIONS',
        headers: { origin: 'https://allowed', 'access-control-request-method': 'POST' },
      }),
    );
    expect(response.status).toBe(204);
    expect(calls).toBe(1);
  });

  it('only intercepts genuine enabled preflights and denies disallowed methods and headers', async () => {
    const router = createRouter({
      policy: { cors: { origins: ['https://allowed'], credentials: true, methods: ['post'], headers: ['X-Token'] } },
    });
    const headers = {
      origin: 'https://allowed',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'x-token',
    };
    const response = await router.handle({ method: 'OPTIONS', path: '/unregistered', headers });
    expect(response.status).toBe(204);
    expect(new Headers(response.headers).get('access-control-allow-origin')).toBe('https://allowed');
    expect(new Headers(response.headers).get('access-control-allow-methods')).toBe('POST');
    expect(
      (
        await router.handle({
          method: 'OPTIONS',
          path: '/',
          headers: { ...headers, 'access-control-request-method': 'DELETE' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await router.handle({
          method: 'OPTIONS',
          path: '/',
          headers: { ...headers, 'access-control-request-headers': 'x-denied' },
        })
      ).status,
    ).toBe(403);
    expect((await router.handle({ method: 'OPTIONS', path: '/', headers: { origin: 'https://allowed' } })).status).toBe(
      404,
    );
    const disabled = createRouter({ policy: { cors: false, securityHeaders: { 'X-Frame-Options': 'DENY' } } });
    expect((await disabled.handle({ method: 'OPTIONS', path: '/', headers })).status).toBe(404);
  });
});

describe('registered middleware', () => {
  it.each([false, true])('runs declarations around exactly one validation with observability %s', async observed => {
    const events: string[] = [];
    const guard = (name: string) => ({
      canActivate: () => {
        events.push(name);
        return true;
      },
    });
    const pipe = (name: string) => ({
      transform: (value: unknown) => {
        events.push(name);
        return String(value) + name;
      },
    });
    const interceptor = (name: string) => ({
      async intercept(_ctx: Ctx, next: () => Promise<unknown>) {
        events.push(name + ':before');
        const result = await next();
        events.push(name + ':after');
        return result;
      },
    });
    @Controller('/composed')
    @UseGuards(guard('class-guard'))
    @UsePipes(pipe('class-pipe'))
    @UseInterceptors(interceptor('class'))
    class Composed {
      @Post()
      @UseGuards(guard('method-guard'))
      @UsePipes(pipe('method-pipe'))
      @UseInterceptors(interceptor('method'))
      post(ctx: Ctx) {
        events.push('handler');
        return text(String(ctx.body));
      }
      @Get('/raw')
      raw(ctx: Ctx) {
        return { value: ctx.body };
      }
    }
    const router = createRouter(
      observed ? { meter: { counter: () => ({ add() {} }), histogram: () => ({ record() {} }) } } : {},
    );
    router.register(new Composed(), {
      post: {
        validateBody: value => {
          events.push('validate');
          return value;
        },
      },
    });
    const response = await router.handle({ method: 'POST', path: '/composed', headers: {}, rawBody: 'body:' });
    expect(await bodyText(response)).toBe('body:class-pipemethod-pipe');
    expect(events).toEqual([
      'class-guard',
      'method-guard',
      'validate',
      'class-pipe',
      'method-pipe',
      'class:before',
      'method:before',
      'handler',
      'method:after',
      'class:after',
    ]);
    const raw = await router.handle({ method: 'GET', path: '/composed/raw', headers: {}, rawBody: 'raw:' });
    expect(JSON.parse(await bodyText(raw))).toEqual({ value: 'raw:class-pipe' });
  });

  it('short circuits before validation and gives method filters precedence', async () => {
    let validated = 0;
    @Controller('/filtered')
    @UseFilters({ catch: () => text('class') })
    class Filtered {
      @Get()
      @UseFilters({ catch: () => text('method') })
      get() {
        throw new Error('failure');
      }
      @Post()
      @UseGuards({ canActivate: () => false })
      post() {
        throw new Error('must not run');
      }
    }
    const router = createRouter();
    router.register(new Filtered(), {
      post: {
        validateBody: value => {
          validated += 1;
          return value;
        },
      },
    });
    expect(await bodyText(await router.handle({ method: 'GET', path: '/filtered', headers: {} }))).toBe('method');
    expect((await router.handle({ method: 'POST', path: '/filtered', headers: {} })).status).toBe(403);
    expect(validated).toBe(0);
  });
});
