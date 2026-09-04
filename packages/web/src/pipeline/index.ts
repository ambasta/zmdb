// @zmdb/web — request pipeline & runtime adapters (epic #272, spec ./SPEC.md).
// Dispatches matched routes through: build Ctx → validate body → invoke handler
// → serialize. Thin, structurally-typed node:http + Fetch adapters (no hard
// deps). No reflection; no `as` on the consumer surface.

import '../polyfill.js';
import { claimsValidationIssues, ValidationError, validationIssuesOf } from '@zmdb/schema-core';

import {
  compilePattern,
  countSegments,
  matchCompiled,
  type CompiledPattern,
  type Ctx,
  type QueryValues,
} from '../context/index.js';
import { getRoutes, type ResolvedRoute } from '../routing/index.js';

export type { Ctx } from '../context/index.js';

/** A minimal, framework-neutral request. */
export interface WebRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody?: unknown;
  readonly query?: QueryValues;
}

/** A minimal, framework-neutral response. */
export interface WebResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Per-handler pipeline options: an optional body validator run before invoke. */
export interface RouteOptions {
  readonly validateBody?: (raw: unknown) => unknown;
}

/** A handler takes one Ctx and returns a (possibly async) result. */
type Handler = (ctx: Ctx<Record<string, string>, unknown, QueryValues>) => unknown;

interface BoundRoute {
  readonly route: ResolvedRoute;
  readonly pattern: CompiledPattern;
  readonly handler: Handler;
  readonly validateBody?: (raw: unknown) => unknown;
}

// Routes are indexed by method, then by segment count, because a route can only
// match a path that agrees on both — so a request never looks at a route it
// could not possibly match. `handle` used to scan every registered route and
// re-split each one's pattern, which made matching O(routes) with a handful of
// allocations per candidate; with a real route table that cost grows without
// bound while the two keys below are known before any comparison happens.
//
// Within a bucket the registration order of `register` is preserved, so
// first-registered-wins is unchanged: a `/user/:id` declared before `/user/me`
// still shadows it, exactly as the flat scan did.
type MethodBuckets = Map<string, BoundRoute[][]>;

function bucketFor(buckets: MethodBuckets, method: string, segmentCount: number): BoundRoute[] {
  let bySegmentCount = buckets.get(method);
  if (bySegmentCount === undefined) {
    bySegmentCount = [];
    buckets.set(method, bySegmentCount);
  }
  let bucket = bySegmentCount[segmentCount];
  if (bucket === undefined) {
    bucket = [];
    bySegmentCount[segmentCount] = bucket;
  }
  return bucket;
}

const JSON_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'application/json' };
const TEXT_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'text/plain; charset=utf-8' };
const NO_HEADERS: Readonly<Record<string, string>> = {};

function jsonResponse(status: number, value: unknown): WebResponse {
  return { status, body: JSON.stringify(value), headers: JSON_HEADERS };
}

// ---- Handler-controlled responses ------------------------------------------
//
// A handler normally returns a plain value and the pipeline serializes it as
// `200 application/json`. That covers a JSON API and nothing else: until these
// factories existed a handler could not choose a status, set a header, or return
// a body that was not JSON, so anything needing one of those had to be done in a
// hand-written adapter outside the framework.
//
// Detection is a marker symbol, deliberately not a structural check. Sniffing
// for a `status` property would be cheaper and needs no new API, but a DTO with
// a `status` field is an entirely ordinary thing to return — `{ status: 'draft' }`
// would silently stop being a body and become an HTTP status. The symbol makes
// "plain object → 200 JSON" provably unchanged for every existing caller.
//
// Symbol.for, not a fresh Symbol: two copies of this package in one process
// (a hoisting mismatch, or an app importing both `@zmdb/web` and `zmdb/web`)
// must still recognise each other's responses.
const RESPONSE_TAG = Symbol.for('zmdb.web.response');

/** Status and headers a response factory accepts. */
export interface ResponseOptions {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

// The tag is non-enumerable so a WebResponse still behaves as the plain
// `{ status, body, headers }` record it always was: JSON.stringify of one, the
// `{ ...response.headers }` spread in toFetchHandler, and Object.keys in `send`
// all see exactly what they saw before.
function tagged(response: WebResponse): WebResponse {
  Object.defineProperty(response, RESPONSE_TAG, { value: true, enumerable: false });
  return response;
}

function isTaggedResponse(value: unknown): value is WebResponse {
  return typeof value === 'object' && value !== null && RESPONSE_TAG in value;
}

/**
 * A JSON response with an explicit status and/or extra headers.
 *
 * `return json(created, { status: 201, headers: { location } })`
 */
export function json(value: unknown, options: ResponseOptions = {}): WebResponse {
  return tagged({
    status: options.status ?? 200,
    body: JSON.stringify(value) ?? '',
    headers: options.headers === undefined ? JSON_HEADERS : { ...JSON_HEADERS, ...options.headers },
  });
}

/**
 * A `text/plain` response, returned byte-for-byte as given.
 *
 * `return text(ctx.params.id)`
 */
export function text(body: string, options: ResponseOptions = {}): WebResponse {
  return tagged({
    status: options.status ?? 200,
    body,
    headers: options.headers === undefined ? TEXT_HEADERS : { ...TEXT_HEADERS, ...options.headers },
  });
}

/**
 * A response with full control and no assumed content type — for HTML, CSV, a
 * redirect, or a `204` with no body. Nothing is added to `headers`, so set
 * `content-type` yourself if the body has one.
 *
 * `return respond({ status: 302, headers: { location: '/login' } })`
 */
export function respond(init: {
  readonly status?: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}): WebResponse {
  return tagged({ status: init.status ?? 200, body: init.body ?? '', headers: init.headers ?? NO_HEADERS });
}

export interface Router {
  register(controller: object, options?: Readonly<Record<string, RouteOptions>>): void;
  handle(req: WebRequest): Promise<WebResponse>;
}

/** Create a router. Routes are read from controllers once at register time. */
export function createRouter(): Router {
  const buckets: MethodBuckets = new Map();

  return {
    register(controller: object, options: Readonly<Record<string, RouteOptions>> = {}): void {
      const ctor = controllerCtor(controller);
      if (ctor === undefined) {
        return;
      }
      for (const route of getRoutes(ctor)) {
        const handler = readHandler(controller, route.handlerName);
        if (handler === undefined) {
          continue;
        }
        // Resolve the pattern's segments and `:param` slots once, here, rather
        // than re-deriving them from the same constant string per request.
        const pattern = compilePattern(route.path);
        const opts = options[route.handlerName];
        bucketFor(buckets, route.method, pattern.segmentCount).push(
          opts?.validateBody === undefined
            ? { route, pattern, handler }
            : { route, pattern, handler, validateBody: opts.validateBody },
        );
      }
    },

    async handle(req: WebRequest): Promise<WebResponse> {
      const method = req.method.toUpperCase();
      const candidates = buckets.get(method)?.[countSegments(req.path)] ?? [];
      for (const bound of candidates) {
        const params = matchCompiled(bound.pattern, req.path);
        if (params === undefined) {
          continue;
        }
        let body = req.rawBody;
        if (bound.validateBody !== undefined) {
          try {
            body = bound.validateBody(req.rawBody);
          } catch (error) {
            const message = messageOf(error);
            const issues = validationIssuesOf(error);
            return jsonResponse(400, issues ? { error: message, issues } : { error: message });
          }
        }
        const ctx: Ctx<Record<string, string>, unknown, QueryValues> = {
          params,
          body,
          query: req.query ?? {},
          headers: req.headers,
          method,
          path: req.path,
        };
        try {
          const result = await bound.handler(ctx);
          // One symbol check on the hot path, no extra allocation: a handler that
          // returns a plain value takes exactly the path it took before.
          return isTaggedResponse(result) ? result : jsonResponse(200, result);
        } catch (error) {
          // A validation error out of the *handler* is the request's fault, not the
          // server's — a write that failed its own schema check on the way to the driver —
          // so it is a 400. Anything else is a 500 with its message and nothing invented.
          if (error instanceof ValidationError || claimsValidationIssues(error)) {
            const message = messageOf(error);
            const issues = validationIssuesOf(error);
            return jsonResponse(400, issues ? { error: message, issues } : { error: message });
          }
          return jsonResponse(500, { error: messageOf(error) });
        }
      }
      return jsonResponse(404, { error: `no route for ${method} ${req.path}` });
    },
  };
}

// The constructor type getRoutes reads metadata from.
type ControllerCtor = abstract new (...args: never[]) => unknown;

// boundary: an instance's `.constructor` carries the Symbol.metadata the class
// decorators wrote; narrowing it to a constructor type for getRoutes is sound.
function controllerCtor(controller: object): ControllerCtor | undefined {
  const ctor = controller.constructor;
  if (typeof ctor !== 'function') {
    return undefined;
  }
  return ctor as ControllerCtor;
}

// boundary: a controller's own decorated methods are the handlers; reading a
// method by its recorded name off the instance and treating it as a Handler is
// sound because getRoutes only yields names of methods the decorators saw. This
// is the single enumerated boundary for the pipeline (ARCHITECTURE.md §2.1).
function readHandler(controller: object, name: string): Handler | undefined {
  const value = Reflect.get(controller, name);
  if (typeof value !== 'function') {
    return undefined;
  }
  const bound = value.bind(controller);
  return bound as Handler;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---- Adapters (structurally typed; no hard node:http / Hono dependency) ----

// The subset of node:http we touch. `setEncoding` and `writeHead` are optional
// because this adapter is structurally typed — a hand-rolled req/res that lacks
// them still works, it just takes the slower path.
interface NodeReqLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: string, listener: (chunk: unknown) => void): void;
  setEncoding?(encoding: string): void;
}
interface NodeResLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  writeHead?(status: number, headers: Readonly<Record<string, string>>): unknown;
  end(body: string): void;
}

/**
 * Adapt a router to a node:http `(req, res)` handler.
 *
 * This is the path real consumers take, so its per-request cost is the
 * framework's real cost. The benchmark harness hand-writes its responses and so
 * never measured this; when it was measured (keep-alive on, 8 workers, c=256,
 * median of 5) the adapter served 294,067 req/s against the hand-written app's
 * 395,983 — 1.35x slower, entirely in the four things below.
 */
export function toNodeHandler(router: Router): (req: NodeReqLike, res: NodeResLike) => void {
  return function (req: NodeReqLike, res: NodeResLike): void {
    // A request with no body needs no 'data'/'end' listeners, no accumulator and
    // no extra event-loop turn — and per RFC 9112 a request with neither
    // content-length nor transfer-encoding HAS no body, which is the same rule
    // node:http itself uses to decide whether to emit 'data' at all. So for the
    // GET/HEAD/DELETE traffic that dominates most services this dispatches
    // straight away instead of registering two closures and waiting a tick.
    if (hasRequestBody(req)) {
      // setEncoding installs a StringDecoder, which holds partial multi-byte
      // sequences across reads. Decoding each chunk separately with
      // String(chunk) — as this used to — corrupts any character whose UTF-8
      // bytes straddle a chunk boundary, so a large body with non-ASCII text
      // would silently arrive with replacement characters in it.
      req.setEncoding?.('utf8');
      let raw = '';
      req.on('data', chunk => {
        raw += String(chunk);
      });
      req.on('end', () => {
        dispatch(router, req, res, raw.length > 0 ? parseJson(raw) : undefined);
      });
      return;
    }
    dispatch(router, req, res, undefined);
  };
}

// content-length: 0 is explicitly "no body"; any other length, or any
// transfer-encoding at all (chunked), means there is one to read.
function hasRequestBody(req: NodeReqLike): boolean {
  const length = req.headers['content-length'];
  if (typeof length === 'string') {
    return length !== '0';
  }
  return req.headers['transfer-encoding'] !== undefined;
}

function dispatch(router: Router, req: NodeReqLike, res: NodeResLike, rawBody: unknown): void {
  // `url.split('?')` allocated an array and split the whole query string just to
  // throw the tail away; indexOf/slice reads the path without either.
  const url = req.url ?? '/';
  const query = url.indexOf('?');
  // `.then(ok, err)` rather than an `async` IIFE with `await`: the IIFE added a
  // second async frame and a second promise to every request on top of the one
  // `router.handle` already returns. The reject arm also means a throw from
  // outside handle's own try/catch becomes a 500 instead of an unhandled
  // rejection that takes the process down.
  void router
    .handle({
      method: req.method ?? 'GET',
      path: query === -1 ? url : url.slice(0, query),
      headers: flattenHeaders(req.headers),
      rawBody,
    })
    .then(
      response => {
        send(res, response);
      },
      (error: unknown) => {
        send(res, jsonResponse(500, { error: messageOf(error) }));
      },
    );
}

function send(res: NodeResLike, response: WebResponse): void {
  // One writeHead with the whole header object beats a setHeader per entry:
  // setHeader was the slowest of the five header strategies measured (78,962
  // req/s against 91,302 for writeHead with an object literal), because each
  // call re-validates the name and touches the outgoing-header map. The common
  // case also hands writeHead the shared frozen JSON_HEADERS constant, so
  // nothing is iterated or allocated at all.
  if (res.writeHead === undefined) {
    res.statusCode = response.status;
    for (const key of Object.keys(response.headers)) {
      res.setHeader(key, response.headers[key] ?? '');
    }
  } else {
    res.writeHead(response.status, response.headers);
  }
  res.end(response.body);
}

/** Adapt a router to a Fetch `(Request) => Promise<Response>` handler. */
export function toFetchHandler(router: Router): (request: Request) => Promise<Response> {
  return async function (request: Request): Promise<Response> {
    const url = new URL(request.url);
    const raw = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readFetchBody(request);
    const response = await router.handle({
      method: request.method,
      path: url.pathname,
      headers: Object.fromEntries(request.headers),
      rawBody: raw,
    });
    return new Response(response.body, { status: response.status, headers: { ...response.headers } });
  };
}

async function readFetchBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  return raw.length > 0 ? parseJson(raw) : undefined;
}

function parseJson(raw: string): unknown {
  try {
    // boundary: JSON.parse yields `any`; we immediately widen to `unknown` so no
    // `any` escapes into the pipeline (validators/handlers narrow from there).
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return raw;
  }
}

// Object.keys allocates one array; Object.entries — which this used to use —
// allocates that array plus a two-element array per header. A request with a
// dozen headers was therefore doing thirteen allocations to read six of them.
function flattenHeaders(headers: Readonly<Record<string, string | string[] | undefined>>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    if (typeof value === 'string') {
      flat[key] = value;
    } else if (Array.isArray(value)) {
      flat[key] = value.join(', ');
    }
  }
  return flat;
}
