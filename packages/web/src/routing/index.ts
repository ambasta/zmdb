// @zmdb/web — controllers & routing (epic #252, spec ./SPEC.md).
// Stage-3 class/method decorators store route data in context.metadata; getRoutes
// composes prefix + method paths. No reflect-metadata, no `as` on the consumer
// surface.

// Ensure Symbol.metadata exists before any decorated class in a consumer module
// is evaluated (Node 26/V8 lacks it). Side-effect import; safe/no-op if present.
import type { CoreSchema } from '@zmdb/schema-core';
import type { Variant } from '@zmdb/schema-core/openapi';
import '@zmdb/app';

import type { HttpMethod } from '../contract/index.js';

export type { HttpMethod } from '../contract/index.js';
export type SchemaVariant = Variant;

export interface RouteSchemaSpec {
  readonly model: CoreSchema<string>;
  readonly variant?: SchemaVariant | undefined;
}

export interface RouteSchemaBinding {
  readonly body?: RouteSchemaSpec | undefined;
  readonly response?: RouteSchemaSpec | undefined;
}

// Raw per-method record written by a verb decorator.
export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handlerName: string;
}

// Prefix-composed route returned by getRoutes.
export interface ResolvedRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handlerName: string;
  readonly schema?: RouteSchemaBinding;
}

// Symbol-keyed metadata slots. Symbols keep our data off the public string
// keyspace of context.metadata.
const ROUTES = Symbol('zmdb.web.routes');
const PREFIX = Symbol('zmdb.web.prefix');
const PUBLIC = Symbol('zmdb.web.public');
const SCHEMAS = Symbol('zmdb.web.schemas');

// A metadata record carrying our slots. All are optional until a decorator
// writes them.
interface RoutingMetadata {
  [ROUTES]?: RouteDefinition[];
  [PREFIX]?: string;
  [PUBLIC]?: string[];
  [SCHEMAS]?: Record<string, RouteSchemaBinding>;
}

// Read our routing view of a metadata record. `context.metadata` and the
// Symbol.metadata record are typed as an index of unknown; this is the single
// trust boundary where we assert our own private symbol slots exist with the
// shape we alone wrote. It is a typed *interface view*, not an `as` cast at the
// call sites.
// boundary: our decorators are the only writers of ROUTES/PREFIX, so viewing the
// record through RoutingMetadata is sound.
function routingView(metadata: DecoratorMetadata): RoutingMetadata {
  return metadata;
}

// Append a route to *this class's own* route list, creating it on first use.
//
// A subclass's metadata record is created with the base's as its prototype, so a
// plain `view[ROUTES]` read on a subclass returns the base's array. Pushing into
// it would write the subclass's route into the base — and therefore into every
// sibling subclass, since they all read through the same object. The own-property
// check keeps each class's declarations local; getRoutes recomposes the chain.
function pushRoute(metadata: DecoratorMetadata, route: RouteDefinition): void {
  const view = routingView(metadata);
  const own = Object.hasOwn(metadata, ROUTES) ? view[ROUTES] : undefined;
  if (own === undefined) {
    view[ROUTES] = [route];
  } else {
    own.push(route);
  }
}

// The routes one metadata record declares itself, ignoring anything it inherits.
function ownRoutes(metadata: DecoratorMetadata): readonly RouteDefinition[] {
  if (!Object.hasOwn(metadata, ROUTES)) {
    return [];
  }
  return routingView(metadata)[ROUTES] ?? [];
}

function ownPublicHandlers(metadata: DecoratorMetadata): readonly string[] {
  if (!Object.hasOwn(metadata, PUBLIC)) {
    return [];
  }
  return routingView(metadata)[PUBLIC] ?? [];
}

// Compose the metadata prototype chain base-first, layering each class's own
// routes over what it inherits. A class that declares any route for a handler
// replaces every inherited route for that same handler, so overriding a method to
// change its path renames the route instead of adding a second one; two verbs on
// one method are both own declarations, so both survive.
function composeRoutes(metadata: DecoratorMetadata): readonly RouteDefinition[] {
  const baseFirst: DecoratorMetadata[] = [];
  for (let record: DecoratorMetadata | null = metadata; record !== null; record = Object.getPrototypeOf(record)) {
    baseFirst.unshift(record);
  }
  let composed: readonly RouteDefinition[] = [];
  for (const record of baseFirst) {
    const own = ownRoutes(record);
    if (own.length === 0) {
      continue;
    }
    const renamed = new Set(own.map(route => route.handlerName));
    composed = [...composed.filter(route => !renamed.has(route.handlerName)), ...own];
  }
  return composed;
}

// Normalize a composed path to a single leading slash, no duplicate slashes, and
// no trailing slash (except the root '/').
function normalizePath(prefix: string, path: string): string {
  const joined = `/${prefix}/${path}`;
  const collapsed = joined.replace(/\/+/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

/** Stage-3 class decorator: record the controller's path prefix. */
export function Controller(prefix = '') {
  return function <T extends abstract new (...args: never[]) => unknown>(
    _target: T,
    context: ClassDecoratorContext<T>,
  ): void {
    routingView(context.metadata)[PREFIX] = prefix;
  };
}

// Build a method decorator for a given HTTP verb.
function methodDecorator(method: HttpMethod) {
  return function (path = '') {
    return function (_target: (...args: never[]) => unknown, context: ClassMethodDecoratorContext): void {
      const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
      pushRoute(context.metadata, { method, path, handlerName });
    };
  };
}

/** `@Get(path?)` route decorator. */
export const Get = methodDecorator('GET');
/** `@Post(path?)` route decorator. */
export const Post = methodDecorator('POST');
/** `@Put(path?)` route decorator. */
export const Put = methodDecorator('PUT');
/** `@Patch(path?)` route decorator. */
export const Patch = methodDecorator('PATCH');
/** `@Delete(path?)` route decorator. */
export const Delete = methodDecorator('DELETE');

/** Mark one route as intentionally unauthenticated for OpenAPI generation. */
export function Public() {
  return function (_target: (...args: never[]) => unknown, context: ClassMethodDecoratorContext): void {
    const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
    const view = routingView(context.metadata);
    const own = Object.hasOwn(context.metadata, PUBLIC) ? view[PUBLIC] : undefined;
    if (own === undefined) {
      view[PUBLIC] = [handlerName];
    } else if (!own.includes(handlerName)) {
      own.push(handlerName);
    }
  };
}

/** Whether the resolved handler is explicitly marked `@Public()`. */
export function isPublic(controller: abstract new (...args: never[]) => unknown, handlerName: string): boolean {
  const metadata = controller[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return false;
  }
  for (let record: DecoratorMetadata | null = metadata; record !== null; record = Object.getPrototypeOf(record)) {
    if (ownRoutes(record).some(route => route.handlerName === handlerName)) {
      return ownPublicHandlers(record).includes(handlerName);
    }
  }
  return false;
}

function isCoreSchema(val: unknown): val is CoreSchema<string> {
  return typeof val === 'object' && val !== null && 'table' in val && 'columns' in val;
}

function isSchemaVariant(val: unknown): val is SchemaVariant {
  return typeof val === 'string';
}

function normalizeSpec(input: unknown, defaultVariant?: SchemaVariant): RouteSchemaSpec | undefined {
  if (!input) return undefined;
  if (isCoreSchema(input)) {
    return { model: input, ...(defaultVariant !== undefined ? { variant: defaultVariant } : {}) };
  }
  if (Array.isArray(input) && isCoreSchema(input[0])) {
    const v = isSchemaVariant(input[1]) ? input[1] : defaultVariant;
    return { model: input[0], ...(v !== undefined ? { variant: v } : {}) };
  }
  if (typeof input === 'object' && input !== null && 'model' in input && isCoreSchema(input.model)) {
    const model = input.model;
    const rawVariant = 'variant' in input ? input.variant : undefined;
    const v = isSchemaVariant(rawVariant) ? rawVariant : defaultVariant;
    return { model, ...(v !== undefined ? { variant: v } : {}) };
  }
  return undefined;
}

export function parseSchemaDecoratorArgs(
  arg1:
    | CoreSchema<string>
    | {
        model?: CoreSchema<string>;
        body?: CoreSchema<string> | RouteSchemaSpec | [CoreSchema<string>, SchemaVariant?] | SchemaVariant;
        response?: CoreSchema<string> | RouteSchemaSpec | [CoreSchema<string>, SchemaVariant?] | SchemaVariant;
      },
  arg2?: SchemaVariant | { body?: SchemaVariant; response?: SchemaVariant } | CoreSchema<string>,
  arg3?: SchemaVariant,
): RouteSchemaBinding {
  if (isCoreSchema(arg1)) {
    const model = arg1;
    if (typeof arg2 === 'string') {
      const v = arg2;
      if (v === 'create' || v === 'update') {
        return {
          body: { model, variant: v },
          response: { model, variant: arg3 ?? 'entity' },
        };
      }
      return {
        response: { model, variant: v },
        ...(arg3 ? { body: { model, variant: arg3 } } : {}),
      };
    }
    if (typeof arg2 === 'object' && arg2 !== null && !isCoreSchema(arg2)) {
      const opts = arg2;
      return {
        ...(opts.body ? { body: { model, variant: opts.body } } : {}),
        ...(opts.response ? { response: { model, variant: opts.response } } : {}),
      };
    }
    if (isCoreSchema(arg2)) {
      return {
        body: { model, variant: 'create' },
        response: { model: arg2, variant: 'entity' },
      };
    }
    return {
      response: { model, variant: 'entity' },
    };
  }

  if (typeof arg1 === 'object' && arg1 !== null) {
    const opts = arg1;

    if (opts.model) {
      const model = opts.model;
      const bodyVar = isSchemaVariant(opts.body) ? opts.body : undefined;
      const respVar = isSchemaVariant(opts.response) ? opts.response : undefined;
      return {
        ...(bodyVar ? { body: { model, variant: bodyVar } } : {}),
        ...(respVar ? { response: { model, variant: respVar } } : { response: { model, variant: 'entity' } }),
      };
    }

    const body = normalizeSpec(opts.body, 'create');
    const response = normalizeSpec(opts.response, 'entity');
    return {
      ...(body ? { body } : {}),
      ...(response ? { response } : {}),
    };
  }

  return {};
}

/** Stage-3 method decorator: attach model schemas and variants to route handlers. */
export function RouteSchema(...args: Parameters<typeof parseSchemaDecoratorArgs>) {
  const binding = parseSchemaDecoratorArgs(...args);
  return function (_target: (...args: never[]) => unknown, context: ClassMethodDecoratorContext): void {
    const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
    const metadata = routingView(context.metadata);
    if (metadata[SCHEMAS] === undefined) {
      metadata[SCHEMAS] = {};
    }
    metadata[SCHEMAS][handlerName] = binding;
  };
}

/** `@Schema(model, variant?)` alias for `@RouteSchema`. */
export const Schema = RouteSchema;

/**
 * Resolve a controller class's routes: prefix composed with each method path,
 * normalized, in declaration order. Reads context.metadata only — no reflection.
 *
 * A subclass gets the routes it inherits followed by its own, under its own
 * prefix; `@Controller` on the subclass is optional, and without it the base's
 * prefix is inherited too. A handler the subclass redeclares keeps only the
 * subclass's path.
 */
export function getRoutes(controller: abstract new (...args: never[]) => unknown): readonly ResolvedRoute[] {
  const metadata = controller[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }
  const view = routingView(metadata);
  const routes = composeRoutes(metadata);
  if (routes.length === 0) {
    return [];
  }
  const prefix = view[PREFIX] ?? '';
  const schemas = view[SCHEMAS] ?? {};
  return routes.map(route => ({
    method: route.method,
    path: normalizePath(prefix, route.path),
    handlerName: route.handlerName,
    ...(schemas[route.handlerName] !== undefined ? { schema: schemas[route.handlerName] } : {}),
  }));
}
