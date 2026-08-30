// @zmdb/web — controllers & routing (epic #252, spec ./SPEC.md).
// Stage-3 class/method decorators store route data in context.metadata; getRoutes
// composes prefix + method paths. No reflect-metadata, no `as` on the consumer
// surface.

// Ensure Symbol.metadata exists before any decorated class in a consumer module
// is evaluated (Node 26/V8 lacks it). Side-effect import; safe/no-op if present.
import '../polyfill.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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

// A metadata record carrying our two slots. Both are optional until a decorator
// writes them.
interface RoutingMetadata {
  [ROUTES]?: RouteDefinition[];
  [PREFIX]?: string;
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

// Append a route to the metadata's route list, creating it on first use.
function pushRoute(metadata: DecoratorMetadata, route: RouteDefinition): void {
  const view = routingView(metadata);
  const existing = view[ROUTES];
  if (existing === undefined) {
    view[ROUTES] = [route];
  } else {
    existing.push(route);
  }
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
    return function (
      _target: (...args: never[]) => unknown,
      context: ClassMethodDecoratorContext,
    ): void {
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

/**
 * Resolve a controller class's routes: prefix composed with each method path,
 * normalized, in declaration order. Reads context.metadata only — no reflection.
 */
export function getRoutes(controller: abstract new (...args: never[]) => unknown): readonly ResolvedRoute[] {
  const metadata = controller[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }
  const view = routingView(metadata);
  const routes = view[ROUTES];
  if (routes === undefined) {
    return [];
  }
  const prefix = view[PREFIX] ?? '';
  return routes.map((route) => ({
    method: route.method,
    path: normalizePath(prefix, route.path),
    handlerName: route.handlerName,
  }));
}
