// @zmdb/web — request pipeline & runtime adapters (epic #272, spec ./SPEC.md).
// Dispatches matched routes through: build Ctx → validate body → invoke handler
// → serialize. Thin, structurally-typed node:http + Fetch adapters (no hard
// deps). No reflection; no `as` on the consumer surface.

import '../polyfill.ts';
import { ValidationError, type ValidationIssue } from '@zmdb/schema-core';

import {
  compilePattern,
  countSegments,
  matchCompiled,
  type CompiledPattern,
  type Ctx,
  type QueryValues,
} from '../context/index.ts';
import { getRoutes, type ResolvedRoute } from '../routing/index.ts';

export type { Ctx } from '../context/index.ts';

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

function jsonResponse(status: number, value: unknown): WebResponse {
  return { status, body: JSON.stringify(value), headers: JSON_HEADERS };
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
            const issues =
              error instanceof ValidationError
                ? error.issues
                : error && typeof error === 'object' && 'issues' in error
                  ? (error as { issues: readonly ValidationIssue[] }).issues
                  : undefined;
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
          return jsonResponse(200, result);
        } catch (error) {
          if (error instanceof ValidationError || (error && typeof error === 'object' && 'issues' in error)) {
            const message = messageOf(error);
            const issues = (error as { issues: readonly ValidationIssue[] }).issues;
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

// The subset of node:http we touch.
interface NodeReqLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: string, listener: (chunk: unknown) => void): void;
}
interface NodeResLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

/** Adapt a router to a node:http `(req, res)` handler. */
export function toNodeHandler(router: Router): (req: NodeReqLike, res: NodeResLike) => void {
  return function (req: NodeReqLike, res: NodeResLike): void {
    const chunks: string[] = [];
    req.on('data', chunk => {
      chunks.push(String(chunk));
    });
    req.on('end', () => {
      void (async () => {
        const raw = chunks.join('');
        const url = req.url ?? '/';
        const path = url.split('?')[0] ?? '/';
        const response = await router.handle({
          method: req.method ?? 'GET',
          path,
          headers: flattenHeaders(req.headers),
          rawBody: raw.length > 0 ? parseJson(raw) : undefined,
        });
        res.statusCode = response.status;
        for (const [key, header] of Object.entries(response.headers)) {
          res.setHeader(key, header);
        }
        res.end(response.body);
      })();
    });
  };
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
  const text = await request.text();
  return text.length > 0 ? parseJson(text) : undefined;
}

function parseJson(text: string): unknown {
  try {
    // boundary: JSON.parse yields `any`; we immediately widen to `unknown` so no
    // `any` escapes into the pipeline (validators/handlers narrow from there).
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return text;
  }
}

function flattenHeaders(headers: Readonly<Record<string, string | string[] | undefined>>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      flat[key] = value;
    } else if (Array.isArray(value)) {
      flat[key] = value.join(', ');
    }
  }
  return flat;
}
