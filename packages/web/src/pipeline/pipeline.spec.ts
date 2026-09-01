import { StringDecoder } from 'node:string_decoder';

import { ValidationError, defineSchema, serial, text as textCol } from '@zmdb/schema-core';
// Tests (#274) for the request pipeline & adapters — RED first (pipeline exports
// absent). Dispatch, param extraction, validate-before-handler, serialize, 404,
// 500, and node/fetch adapters. Per packages/web/src/pipeline/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Controller, Get, Post } from '../routing/index.js';
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

const AccountSchema = defineSchema('accounts', {
  id: serial().primaryKey(),
  email: textCol().notNull(),
  secretToken: textCol().sensitive(),
});

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

  @Get('/account/:id')
  getAccount(ctx: Ctx<{ id: string }>) {
    return { id: Number(ctx.params.id), email: 'user@example.com', secretToken: 'super-secret' };
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
    getAccount: {
      schema: AccountSchema,
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

describe('@zmdb/web pipeline: schema fast stringification', () => {
  it('formats schema-backed response and automatically excludes sensitive fields', async () => {
    const res = await makeRouter().handle({ method: 'GET', path: '/users/account/10', headers: {} });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"id":10,"email":"user@example.com"}');
    expect(res.body).not.toContain('secretToken');
  });

  it('falls back seamlessly to standard JSON serialization for non-schema routes', async () => {
    const res = await makeRouter().handle({ method: 'GET', path: '/users/42', headers: {} });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"id":"42"}');
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
