// @zmdb/web — request pipeline & runtime adapters (epic #272, spec ./SPEC.md).
// Dispatches matched routes through: build Ctx → run route guards → validate
// body → invoke handler → serialize. Thin, structurally-typed node:http + Fetch
// adapters (no hard deps). No reflection; no `as` on the consumer surface.

import '../polyfill.js';
import type { FileHandle } from 'node:fs/promises';

import { claimsValidationIssues, ValidationError, validationIssuesOf } from '@zmdb/schema-core';

import {
  compilePattern,
  countSegments,
  matchCompiled,
  type CompiledPattern,
  type Ctx,
  type QueryValues,
} from '../context/index.js';
import type { Constructor } from '../di/index.js';
import type { Guard } from '../middleware/index.js';
import { getRoutes, isPublic, type ResolvedRoute } from '../routing/index.js';
import { resolveGuards, type GuardRegistry } from './guards.js';

export type { Ctx } from '../context/index.js';
export type { GuardRegistry } from './guards.js';

/** A minimal, framework-neutral request. */
export interface WebRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody?: unknown;
  readonly query?: QueryValues;
}

/** A minimal, framework-neutral response body. */
export type ResponseBody =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> }
  | {
      readonly kind: 'stream';
      readonly value: ReadableStream<Uint8Array<ArrayBuffer>>;
      readonly length: number | undefined;
    };

/** A minimal, framework-neutral response. */
export interface WebResponse {
  readonly status: number;
  readonly body: ResponseBody;
  readonly headers: Readonly<Record<string, string>>;
}

/** An OpenAPI security requirement maps each required scheme to its scopes. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

/** Per-handler pipeline, guard and OpenAPI options. */
export interface RouteOptions {
  readonly validateBody?: (raw: unknown) => unknown;
  readonly guards?: readonly Guard[];
  readonly security?: readonly SecurityRequirement[];
  readonly deprecated?: true;
}

/** Router-wide guard configuration shared with OpenAPI generation. */
export interface RouterOptions {
  readonly guardRegistry?: GuardRegistry;
}

/** A handler takes one Ctx and returns a (possibly async) result. */
type Handler = (ctx: Ctx<Record<string, string>, unknown, QueryValues>) => unknown;

interface BoundRoute {
  readonly route: ResolvedRoute;
  readonly pattern: CompiledPattern;
  readonly handler: Handler;
  readonly validateBody?: (raw: unknown) => unknown;
  readonly guards?: readonly Guard[];
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
const TEXT_BODY_KIND = 'text';
const EMPTY_TEXT: ResponseBody = Object.freeze({ kind: 'text', value: '' });
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function jsonResponse(status: number, value: unknown): WebResponse {
  return { status, body: textBody(JSON.stringify(value) ?? ''), headers: JSON_HEADERS };
}

function textBody(value: string): ResponseBody {
  return value.length === 0 ? EMPTY_TEXT : { kind: 'text', value };
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

/** Options for a streamed response. */
export interface StreamOptions extends ResponseOptions {
  readonly length?: number;
  readonly onError: (error: unknown) => void;
}

/** Options for a response streamed from a known file path. */
export interface FileResponseOptions extends ResponseOptions {
  readonly contentType?: string;
  readonly onError: (error: unknown) => void;
}

// The tag is non-enumerable so a WebResponse remains the plain
// `{ status, body, headers }` record consumers expect at the top level.
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
    body: textBody(JSON.stringify(value) ?? ''),
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
    body: textBody(body),
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
  return tagged({ status: init.status ?? 200, body: textBody(init.body ?? ''), headers: init.headers ?? NO_HEADERS });
}

/** A byte response with no implicit content type. */
export function bytes(value: Uint8Array<ArrayBuffer>, options: ResponseOptions = {}): WebResponse {
  return tagged({
    status: options.status ?? 200,
    body: { kind: 'bytes', value },
    headers: options.headers ?? NO_HEADERS,
  });
}

/** A streaming response whose failures are reported exactly once. */
export function stream(value: ReadableStream<Uint8Array<ArrayBuffer>>, options: StreamOptions): WebResponse {
  if (options.length !== undefined && (!Number.isSafeInteger(options.length) || options.length < 0)) {
    throw new RangeError('length must be a non-negative safe integer');
  }
  return tagged({
    status: options.status ?? 200,
    body: {
      kind: 'stream',
      value: reportingStream(value, options.length, options.onError),
      length: options.length,
    },
    headers: options.headers ?? NO_HEADERS,
  });
}

/** Stream one known file path. Path confinement belongs to the static-file handler. */
export async function file(path: string, options: FileResponseOptions): Promise<WebResponse> {
  let handle: FileHandle | undefined;
  try {
    const { open } = await import('node:fs/promises');
    handle = await open(path, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`not a file: ${path}`);
    }
    const body = fileHandleStream(handle);
    const headers =
      options.contentType === undefined ? options.headers : { ...options.headers, 'content-type': options.contentType };
    return stream(body, {
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(headers === undefined ? {} : { headers }),
      length: stat.size,
      onError: options.onError,
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    options.onError(error);
    throw error;
  }
}

/** Decode a response body for assertions and other in-process consumers. */
export async function bodyText(response: WebResponse): Promise<string> {
  switch (response.body.kind) {
    case TEXT_BODY_KIND:
      return response.body.value;
    case 'bytes':
      return new TextDecoder().decode(response.body.value);
    case 'stream':
      return new Response(response.body.value).text();
  }
}

function reportingStream(
  source: ReadableStream<Uint8Array<ArrayBuffer>>,
  expectedLength: number | undefined,
  onError: (error: unknown) => void,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const reader = source.getReader();
  let reported = false;
  let received = 0;
  const report = (error: unknown): void => {
    if (!reported) {
      reported = true;
      onError(error);
    }
  };
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          if (expectedLength !== undefined && received !== expectedLength) {
            throw new Error(
              `stream length mismatch: expected ${String(expectedLength)} bytes, received ${String(received)}`,
            );
          }
          controller.close();
          return;
        }
        received += next.value.byteLength;
        if (expectedLength !== undefined && received > expectedLength) {
          throw new Error(
            `stream length mismatch: expected ${String(expectedLength)} bytes, received at least ${String(received)}`,
          );
        }
        controller.enqueue(next.value);
      } catch (error) {
        report(error);
        void reader.cancel(error).catch(report);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch (error) {
        report(error);
        throw error;
      }
    },
  });
}

function fileHandleStream(handle: FileHandle): ReadableStream<Uint8Array<ArrayBuffer>> {
  let closed = false;
  const close = async (): Promise<void> => {
    if (!closed) {
      closed = true;
      await handle.close();
    }
  };
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const chunk = new Uint8Array(64 * 1024);
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) {
          await close();
          controller.close();
          return;
        }
        controller.enqueue(chunk.slice(0, bytesRead));
      } catch (error) {
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel: close,
  });
}

export interface Router {
  register(controller: object, options?: Readonly<Record<string, RouteOptions>>): void;
  registerDeferred(controller: Constructor<object>, instance: () => Promise<object>): void;
  handle(req: WebRequest): Promise<WebResponse>;
}

/** Create a router. Routes and their effective guards are resolved once at register time. */
export function createRouter(routerOptions: RouterOptions = {}): Router {
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
        const routeGuards = opts?.guards ?? [];
        const publicRoute = isPublic(ctor, route.handlerName);
        if (publicRoute && (routeGuards.length > 0 || (opts?.security !== undefined && opts.security.length > 0))) {
          throw new Error(
            `Guard configuration error at ${ctor.name}.${route.handlerName}: an @Public() route cannot declare route guards or a non-empty security requirement`,
          );
        }
        const guards = publicRoute ? [] : resolveGuards(routerOptions.guardRegistry, ctor.name, routeGuards);
        bucketFor(buckets, route.method, pattern.segmentCount).push({
          route,
          pattern,
          handler,
          ...(opts?.validateBody === undefined ? {} : { validateBody: opts.validateBody }),
          ...(guards.length === 0 ? {} : { guards }),
        });
      }
    },

    registerDeferred(controller: Constructor<object>, instance: () => Promise<object>): void {
      for (const route of getRoutes(controller)) {
        let resolved: Handler | undefined;
        const handler: Handler = async ctx => {
          if (resolved === undefined) {
            const built = await instance();
            resolved = readHandler(built, route.handlerName);
            if (resolved === undefined) {
              throw new Error(`@zmdb/web: controller has no handler named "${route.handlerName}"`);
            }
          }
          return resolved(ctx);
        };
        const pattern = compilePattern(route.path);
        const guards = isPublic(controller, route.handlerName)
          ? []
          : resolveGuards(routerOptions.guardRegistry, controller.name);
        bucketFor(buckets, route.method, pattern.segmentCount).push({
          route,
          pattern,
          handler,
          ...(guards.length === 0 ? {} : { guards }),
        });
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
        const ctx = {
          params,
          body: req.rawBody,
          query: req.query ?? {},
          headers: req.headers,
          method,
          path: req.path,
        };
        for (const guard of bound.guards ?? []) {
          try {
            if (!(await guard.canActivate(ctx))) {
              return jsonResponse(403, { error: 'forbidden' });
            }
          } catch (error) {
            return jsonResponse(500, { error: messageOf(error) });
          }
        }

        if (bound.validateBody !== undefined) {
          try {
            ctx.body = bound.validateBody(req.rawBody);
          } catch (error) {
            const message = messageOf(error);
            const issues = validationIssuesOf(error);
            return jsonResponse(400, issues ? { error: message, issues } : { error: message });
          }
        }
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
  write(chunk: Uint8Array<ArrayBuffer>): boolean;
  once(event: string, listener: () => void): void;
  destroy(error?: Error): void;
  end(body?: string | Uint8Array<ArrayBuffer>): void;
}

/** Request-body limits shared by the Node and Fetch adapters. */
export interface AdapterOptions {
  readonly maxBodyBytes: number;
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
export function toNodeHandler(
  router: Router,
  options: AdapterOptions = { maxBodyBytes: DEFAULT_MAX_BODY_BYTES },
): (req: NodeReqLike, res: NodeResLike) => void {
  validateMaxBodyBytes(options.maxBodyBytes);
  return function (req: NodeReqLike, res: NodeResLike): void {
    // A request with no body needs no 'data'/'end' listeners, no accumulator and
    // no extra event-loop turn — and per RFC 9112 a request with neither
    // content-length nor transfer-encoding HAS no body, which is the same rule
    // node:http itself uses to decide whether to emit 'data' at all. So for the
    // GET/HEAD/DELETE traffic that dominates most services this dispatches
    // straight away instead of registering two closures and waiting a tick.
    if (hasRequestBody(req)) {
      const announcedLength = requestContentLength(req);
      if (announcedLength !== undefined && announcedLength > options.maxBodyBytes) {
        rejectOversizedRequest(res);
        return;
      }
      const binary = hasBinaryContentType(req.headers['content-type']);
      let size = 0;
      let exceeded = false;
      const byteChunks: Uint8Array<ArrayBuffer>[] = [];
      let raw = '';
      // setEncoding installs a StringDecoder, which holds partial multi-byte
      // sequences across reads. Decoding each chunk separately with
      // String(chunk) — as this used to — corrupts any character whose UTF-8
      // bytes straddle a chunk boundary, so a large body with non-ASCII text
      // would silently arrive with replacement characters in it.
      if (!binary) {
        req.setEncoding?.('utf8');
      }
      req.on('data', chunk => {
        if (exceeded) {
          return;
        }
        if (binary) {
          const chunkValue = chunkBytes(chunk);
          size += chunkValue.byteLength;
          if (size <= options.maxBodyBytes) {
            byteChunks.push(chunkValue);
          }
        } else {
          const chunkValue = String(chunk);
          size += new TextEncoder().encode(chunkValue).byteLength;
          if (size <= options.maxBodyBytes) {
            raw += chunkValue;
          }
        }
        if (size > options.maxBodyBytes) {
          exceeded = true;
          rejectOversizedRequest(res);
        }
      });
      req.on('end', () => {
        if (exceeded) {
          return;
        }
        const requestBody = binary ? joinBytes(byteChunks, size) : raw.length > 0 ? parseJson(raw) : undefined;
        dispatch(router, req, res, requestBody);
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
        send(res, response, req.method ?? 'GET');
      },
      (error: unknown) => {
        send(res, jsonResponse(500, { error: messageOf(error) }), req.method ?? 'GET');
      },
    );
}

function send(res: NodeResLike, response: WebResponse, method: string): void {
  const noBody = method.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 304;
  if (noBody) {
    if (response.body.kind === 'stream') {
      void response.body.value.cancel('response has no body').catch(() => undefined);
    }
    writeNodeHead(res, response.status, withoutFramingHeaders(response.headers));
    res.end();
    return;
  }
  switch (response.body.kind) {
    case TEXT_BODY_KIND:
      writeNodeHead(res, response.status, withoutTransferEncoding(response.headers));
      res.end(response.body.value);
      return;
    case 'bytes': {
      const headers = withContentLength(response.headers, response.body.value.byteLength);
      writeNodeHead(res, response.status, headers);
      res.end(response.body.value);
      return;
    }
    case 'stream':
      void sendNodeStream(res, response);
  }
}

function writeNodeHead(res: NodeResLike, status: number, headers: Readonly<Record<string, string>>): void {
  // One writeHead with the whole header object beats a setHeader per entry:
  // setHeader was the slowest of the five header strategies measured (78,962
  // req/s against 91,302 for writeHead with an object literal), because each
  // call re-validates the name and touches the outgoing-header map. The common
  // case also hands writeHead the shared frozen JSON_HEADERS constant, so
  // nothing is iterated or allocated at all.
  if (res.writeHead === undefined) {
    res.statusCode = status;
    for (const key of Object.keys(headers)) {
      res.setHeader(key, headers[key] ?? '');
    }
  } else {
    res.writeHead(status, headers);
  }
}

async function sendNodeStream(res: NodeResLike, response: WebResponse): Promise<void> {
  if (response.body.kind !== 'stream') {
    return;
  }
  const reader = response.body.value.getReader();
  let headersWritten = false;
  let complete = false;
  let disconnected = false;
  let markDisconnected: () => void = () => undefined;
  const disconnectedSignal = new Promise<void>(resolve => {
    markDisconnected = resolve;
  });
  res.once('close', () => {
    if (!complete) {
      disconnected = true;
      markDisconnected();
      void reader.cancel('client disconnected').catch(() => undefined);
    }
  });
  try {
    const first = await reader.read();
    if (disconnected) {
      complete = true;
      return;
    }
    const headers =
      response.body.length === undefined
        ? withoutFramingHeaders(response.headers)
        : withContentLength(response.headers, response.body.length);
    if (first.done) {
      writeNodeHead(res, response.status, headers);
      headersWritten = true;
      complete = true;
      res.end();
      return;
    }
    writeNodeHead(res, response.status, headers);
    headersWritten = true;
    if (!res.write(first.value)) {
      await Promise.race([nodeDrain(res), disconnectedSignal]);
      if (disconnected) {
        complete = true;
        return;
      }
    }
    for (;;) {
      const next = await reader.read();
      if (disconnected) {
        complete = true;
        return;
      }
      if (next.done) {
        complete = true;
        res.end();
        return;
      }
      if (!res.write(next.value)) {
        await Promise.race([nodeDrain(res), disconnectedSignal]);
        if (disconnected) {
          complete = true;
          return;
        }
      }
    }
  } catch (error) {
    complete = true;
    if (disconnected) {
      return;
    }
    if (!headersWritten) {
      send(res, jsonResponse(500, { error: messageOf(error) }), 'GET');
      return;
    }
    res.destroy(error instanceof Error ? error : new Error(String(error)));
  }
}

function nodeDrain(res: NodeResLike): Promise<void> {
  return new Promise(resolve => {
    res.once('drain', resolve);
  });
}

/** Adapt a router to a Fetch `(Request) => Promise<Response>` handler. */
export function toFetchHandler(
  router: Router,
  options: AdapterOptions = { maxBodyBytes: DEFAULT_MAX_BODY_BYTES },
): (request: Request) => Promise<Response> {
  validateMaxBodyBytes(options.maxBodyBytes);
  return async function (request: Request): Promise<Response> {
    const url = new URL(request.url);
    const raw =
      request.method === 'GET' || request.method === 'HEAD'
        ? { ok: true as const, value: undefined }
        : await readFetchBody(request, options.maxBodyBytes);
    if (!raw.ok) {
      return new Response(null, { status: 413 });
    }
    const response = await router.handle({
      method: request.method,
      path: url.pathname,
      headers: Object.fromEntries(request.headers),
      rawBody: raw.value,
    });
    const headers = fetchHeaders(response);
    if (request.method === 'HEAD' || response.status === 204 || response.status === 304) {
      if (response.body.kind === 'stream') {
        await response.body.value.cancel('response has no body').catch(() => undefined);
      }
      headers.delete('content-length');
      return new Response(null, { status: response.status, headers });
    }
    switch (response.body.kind) {
      case TEXT_BODY_KIND:
        return new Response(fetchTextBody(response.body.value, headers), { status: response.status, headers });
      case 'bytes':
        return new Response(response.body.value, { status: response.status, headers });
      case 'stream':
        return new Response(response.body.value, { status: response.status, headers });
    }
  };
}

async function readFetchBody(
  request: Request,
  maxBodyBytes: number,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  const announced = request.headers.get('content-length');
  if (announced !== null && Number(announced) > maxBodyBytes) {
    await request.body?.cancel('request body exceeds maxBodyBytes');
    return { ok: false };
  }
  if (request.body === null) {
    return { ok: true, value: undefined };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    size += next.value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel('request body exceeds maxBodyBytes');
      return { ok: false };
    }
    chunks.push(new Uint8Array(next.value));
  }
  const joined = joinBytes(chunks, size);
  if (joined.byteLength === 0) {
    return { ok: true, value: undefined };
  }
  if (hasBinaryContentType(request.headers.get('content-type') ?? undefined)) {
    return { ok: true, value: joined };
  }
  return { ok: true, value: parseJson(new TextDecoder().decode(joined)) };
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

function validateMaxBodyBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('maxBodyBytes must be a positive safe integer');
  }
}

function requestContentLength(req: NodeReqLike): number | undefined {
  const value = req.headers['content-length'];
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function hasBinaryContentType(value: string | readonly string[] | undefined): boolean {
  const contentType = Array.isArray(value) ? value[0] : value;
  if (contentType === undefined) {
    return false;
  }
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType !== 'application/json' && !mediaType.endsWith('+json') && !mediaType.startsWith('text/');
}

function chunkBytes(chunk: unknown): Uint8Array<ArrayBuffer> {
  return chunk instanceof Uint8Array ? new Uint8Array(chunk) : new TextEncoder().encode(String(chunk));
}

function joinBytes(chunks: readonly Uint8Array<ArrayBuffer>[], size: number): Uint8Array<ArrayBuffer> {
  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function rejectOversizedRequest(res: NodeResLike): void {
  send(res, jsonResponse(413, { error: 'request body exceeds maxBodyBytes' }), 'POST');
  res.destroy(new Error('request body exceeds maxBodyBytes'));
}

function withoutTransferEncoding(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return omitHeaders(headers, false);
}

function withoutFramingHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return omitHeaders(headers, true);
}

function omitHeaders(
  headers: Readonly<Record<string, string>>,
  removeContentLength: boolean,
): Readonly<Record<string, string>> {
  let found = false;
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'transfer-encoding' || (removeContentLength && lower === 'content-length')) {
      found = true;
      break;
    }
  }
  if (!found) {
    return headers;
  }
  const clean: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower !== 'transfer-encoding' && (!removeContentLength || lower !== 'content-length')) {
      clean[key] = headers[key] ?? '';
    }
  }
  return clean;
}

function withContentLength(
  headers: Readonly<Record<string, string>>,
  length: number,
): Readonly<Record<string, string>> {
  return { ...withoutFramingHeaders(headers), 'content-length': String(length) };
}

function fetchHeaders(response: WebResponse): Headers {
  const headers = new Headers(withoutTransferEncoding(response.headers));
  if (response.body.kind === 'bytes') {
    headers.set('content-length', String(response.body.value.byteLength));
  } else if (response.body.kind === 'stream') {
    if (response.body.length === undefined) {
      headers.delete('content-length');
    } else {
      headers.set('content-length', String(response.body.length));
    }
  }
  return headers;
}

function fetchTextBody(value: string, headers: Headers): string | Uint8Array<ArrayBuffer> | null {
  if (value.length === 0) {
    return null;
  }
  return headers.has('content-type') ? value : new TextEncoder().encode(value);
}
