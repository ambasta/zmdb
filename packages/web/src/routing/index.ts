// @zmdb/web — controllers & routing (epic #252, spec ./SPEC.md).
// Stage-3 class/method decorators store route data in context.metadata; getRoutes
// composes prefix + method paths. No reflect-metadata, no `as` on the consumer
// surface.

// Ensure Symbol.metadata exists before any decorated class in a consumer module
// is evaluated (Node 26/V8 lacks it). Side-effect import; safe/no-op if present.
import '@zmdb/app';
import type { Token } from '@zmdb/app/di';

import type { HttpMethod } from '../contract/index.js';
import type { Chain, Guard, Pipe, Interceptor, ExceptionFilter } from '../middleware/index.js';

export type { HttpMethod } from '../contract/index.js';

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
}

// Symbol-keyed metadata slots. Symbols keep our data off the public string
// keyspace of context.metadata.
const ROUTES = Symbol('zmdb.web.routes');
const PREFIX = Symbol('zmdb.web.prefix');
const PUBLIC = Symbol('zmdb.web.public');

// A metadata record carrying our two slots. Both are optional until a decorator
// writes them.
interface RoutingMetadata {
  [ROUTES]?: RouteDefinition[];
  [PREFIX]?: string;
  [PUBLIC]?: string[];
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
  return routes.map(route => ({
    method: route.method,
    path: normalizePath(prefix, route.path),
    handlerName: route.handlerName,
  }));
}

/** Middleware declarations are inert instances or typed application injection tokens. */
export type MiddlewareDeclaration<T> = T | Token<T>;
export interface MiddlewareDeclarations {
  readonly guards: readonly MiddlewareDeclaration<Guard>[];
  readonly pipes: readonly MiddlewareDeclaration<Pipe>[];
  readonly interceptors: readonly MiddlewareDeclaration<Interceptor>[];
  readonly filters: readonly MiddlewareDeclaration<ExceptionFilter>[];
}

const MIDDLEWARE = Symbol('zmdb.web.middleware');
interface MiddlewareMetadata {
  [MIDDLEWARE]?: Map<string | undefined, MiddlewareDeclarations>;
}
const EMPTY_MIDDLEWARE: MiddlewareDeclarations = { guards: [], pipes: [], interceptors: [], filters: [] };
const preparedMiddleware = new WeakMap<object, ReadonlyMap<string, Chain>>();

function middlewareDecorator<K extends keyof MiddlewareDeclarations>(kind: K) {
  return (...values: MiddlewareDeclarations[K]) =>
    (_target: unknown, context: ClassDecoratorContext | ClassMethodDecoratorContext): void => {
      const metadata: MiddlewareMetadata = context.metadata;
      if (!Object.hasOwn(context.metadata, MIDDLEWARE)) metadata[MIDDLEWARE] = new Map();
      const own = metadata[MIDDLEWARE];
      const name = context.kind === 'class' ? undefined : String(context.name);
      const current = own?.get(name) ?? EMPTY_MIDDLEWARE;
      own?.set(name, { ...current, [kind]: [...values, ...current[kind]] });
    };
}

export const UseGuards = middlewareDecorator('guards');
export const UsePipes = middlewareDecorator('pipes');
export const UseInterceptors = middlewareDecorator('interceptors');
export const UseFilters = middlewareDecorator('filters');

function declarationsOf(
  controller: abstract new (...args: never[]) => unknown,
  handler: string,
): MiddlewareDeclarations {
  const layers: MiddlewareDeclarations[] = [];
  const methods: MiddlewareDeclarations[] = [];
  for (let record = controller[Symbol.metadata]; record != null; record = Object.getPrototypeOf(record)) {
    if (!Object.hasOwn(record, MIDDLEWARE)) continue;
    const metadata: MiddlewareMetadata = record;
    const own = metadata[MIDDLEWARE];
    const classLayer = own?.get(undefined);
    const methodLayer = own?.get(handler);
    if (classLayer !== undefined) layers.unshift(classLayer);
    if (methodLayer !== undefined) methods.unshift(methodLayer);
  }
  return {
    guards: [...layers, ...methods].flatMap(layer => layer.guards),
    pipes: [...layers, ...methods].flatMap(layer => layer.pipes),
    interceptors: [...layers, ...methods].flatMap(layer => layer.interceptors),
    filters: [...methods, ...layers].flatMap(layer => layer.filters),
  };
}

export type MiddlewareResolver = <T>(token: Token<T>) => T;

function resolveDeclaration<T extends object>(
  value: MiddlewareDeclaration<T>,
  member: keyof T,
  resolve?: MiddlewareResolver,
): T {
  if (isMiddlewareInstance(value, member)) return value;
  if (resolve === undefined)
    throw new Error(`@zmdb/web: middleware token "${value.description}" requires application DI`);
  return resolve(value);
}

function isMiddlewareInstance<T extends object>(value: MiddlewareDeclaration<T>, member: keyof T): value is T {
  return member in value;
}

function resolveDeclarations(
  controller: abstract new (...args: never[]) => unknown,
  handler: string,
  resolve?: MiddlewareResolver,
): Chain {
  const declared = declarationsOf(controller, handler);
  return {
    guards: declared.guards.map(value => resolveDeclaration(value, 'canActivate', resolve)),
    pipes: declared.pipes.map(value => resolveDeclaration(value, 'transform', resolve)),
    interceptors: declared.interceptors.map(value => resolveDeclaration(value, 'intercept', resolve)),
    filters: declared.filters.map(value => resolveDeclaration(value, 'catch', resolve)),
  };
}

/** Internal app registration bridge: resolve declarations before lifecycle initialization. */
export function prepareMiddleware(controller: object, resolve: MiddlewareResolver): readonly object[] {
  const ctor = controller.constructor;
  if (typeof ctor !== 'function') return [];
  const constructor = middlewareConstructor(ctor);
  const chains = new Map<string, Chain>();
  for (const route of getRoutes(constructor)) {
    if (!chains.has(route.handlerName))
      chains.set(route.handlerName, resolveDeclarations(constructor, route.handlerName, resolve));
  }
  preparedMiddleware.set(controller, chains);
  return [...chains.values()].flatMap(chain => [
    ...chain.guards,
    ...chain.pipes,
    ...chain.interceptors,
    ...chain.filters,
  ]);
}

// Boundary: instance.constructor is the controller constructor supplied by the module graph.
function middlewareConstructor(value: Function): abstract new (...args: never[]) => unknown {
  return value as abstract new (...args: never[]) => unknown;
}

/** Resolve standalone instances, or use the app's already prepared declaration instances. */
export function middlewareFor(
  controller: object,
  ctor: abstract new (...args: never[]) => unknown,
  handler: string,
): Chain {
  return preparedMiddleware.get(controller)?.get(handler) ?? resolveDeclarations(ctor, handler);
}
