// @zmdb/web — guards, pipes, interceptors & exception filters (epic #287, spec
// ./SPEC.md). A Chain composes middleware around a handler in deterministic
// order. Static composition, no reflection, no `as` on the consumer surface.

import type { Ctx, QueryValues } from '../context/index.js';
import type { WebResponse } from '../pipeline/index.js';
import { BoundaryStatusError, ChainError } from './errors.js';

export { ChainError } from './errors.js';

export type AnyCtx = Ctx<Record<string, string>, unknown, QueryValues>;

/** Authorization gate: a `false` short-circuits the request (403). */
export interface Guard {
  canActivate(ctx: AnyCtx): boolean | Promise<boolean>;
}

/** A guard that declares the OpenAPI security scheme and scopes it enforces. */
export interface SecurityAwareGuard extends Guard {
  readonly enforces: { readonly scheme: string; readonly scopes: readonly string[] };
}

/** Transform/validate a value; ordinary throws yield 400. */
export interface Pipe<In = unknown, Out = unknown> {
  transform(value: In, ctx: AnyCtx): Out | Promise<Out>;
}

/** Wrap the rest of the chain (handler) with pre/post behavior. */
export interface Interceptor {
  intercept(ctx: AnyCtx, next: () => Promise<unknown>): Promise<unknown>;
}

/** Map a thrown error to a response. */
export interface ExceptionFilter {
  catch(error: unknown, ctx: AnyCtx): WebResponse | undefined;
}

/** A composed middleware chain for a route. */
export interface Chain {
  readonly guards: readonly Guard[];
  readonly pipes: readonly Pipe[];
  readonly interceptors: readonly Interceptor[];
  readonly filters: readonly ExceptionFilter[];
}

/** A handler invoked with the (piped) ctx. */
export type ChainHandler = (ctx: AnyCtx) => unknown;

// Symbols for metadata slots
const METHOD_GUARDS = Symbol('zmdb.web.method_guards');
const METHOD_PIPES = Symbol('zmdb.web.method_pipes');
const METHOD_INTERCEPTORS = Symbol('zmdb.web.method_interceptors');
const METHOD_FILTERS = Symbol('zmdb.web.method_filters');

const CLASS_GUARDS = Symbol('zmdb.web.class_guards');
const CLASS_PIPES = Symbol('zmdb.web.class_pipes');
const CLASS_INTERCEPTORS = Symbol('zmdb.web.class_interceptors');
const CLASS_FILTERS = Symbol('zmdb.web.class_filters');

type Constructor<T> = new (...args: never[]) => T;

type GuardInput = Guard | Constructor<Guard>;
type PipeInput = Pipe | Constructor<Pipe>;
type InterceptorInput = Interceptor | Constructor<Interceptor>;
type FilterInput = ExceptionFilter | Constructor<ExceptionFilter>;

interface MiddlewareMetadata {
  [METHOD_GUARDS]?: Record<string, GuardInput[]>;
  [METHOD_PIPES]?: Record<string, PipeInput[]>;
  [METHOD_INTERCEPTORS]?: Record<string, InterceptorInput[]>;
  [METHOD_FILTERS]?: Record<string, FilterInput[]>;

  [CLASS_GUARDS]?: GuardInput[];
  [CLASS_PIPES]?: PipeInput[];
  [CLASS_INTERCEPTORS]?: InterceptorInput[];
  [CLASS_FILTERS]?: FilterInput[];
}

function middlewareView(metadata: DecoratorMetadata): MiddlewareMetadata {
  return metadata;
}

function isObjectRecord(value: unknown): value is Record<string, unknown[]> {
  return typeof value === 'object' && value !== null;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function pushMethodMiddleware(
  metadata: DecoratorMetadata,
  slot: symbol,
  handlerName: string,
  items: readonly unknown[],
): void {
  const rawMap: unknown = Reflect.get(metadata, slot);
  let map: Record<string, unknown[]>;
  if (isObjectRecord(rawMap)) {
    map = rawMap;
  } else {
    map = {};
    Reflect.set(metadata, slot, map);
  }
  const existing = map[handlerName];
  if (existing !== undefined) {
    map[handlerName] = [...items, ...existing];
  } else {
    map[handlerName] = [...items];
  }
}

function pushClassMiddleware(metadata: DecoratorMetadata, slot: symbol, items: readonly unknown[]): void {
  const rawList: unknown = Reflect.get(metadata, slot);
  let list: unknown[];
  if (isArray(rawList)) {
    list = rawList;
  } else {
    list = [];
    Reflect.set(metadata, slot, list);
  }
  list.unshift(...items);
}

/** Decorate route methods or controllers with authorization guards. */
export function UseGuards(...guards: readonly (GuardInput | readonly GuardInput[])[]) {
  const flat = guards.flat(Infinity);
  return function (_target: unknown, context: ClassMethodDecoratorContext | ClassDecoratorContext): void {
    if (context.kind === 'method') {
      const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
      pushMethodMiddleware(context.metadata, METHOD_GUARDS, handlerName, flat);
    } else if (context.kind === 'class') {
      pushClassMiddleware(context.metadata, CLASS_GUARDS, flat);
    }
  };
}

/** Decorate route methods or controllers with transformation/validation pipes. */
export function UsePipes(...pipes: readonly (PipeInput | readonly PipeInput[])[]) {
  const flat = pipes.flat(Infinity);
  return function (_target: unknown, context: ClassMethodDecoratorContext | ClassDecoratorContext): void {
    if (context.kind === 'method') {
      const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
      pushMethodMiddleware(context.metadata, METHOD_PIPES, handlerName, flat);
    } else if (context.kind === 'class') {
      pushClassMiddleware(context.metadata, CLASS_PIPES, flat);
    }
  };
}

/** Decorate route methods or controllers with interceptors. */
export function UseInterceptors(...interceptors: readonly (InterceptorInput | readonly InterceptorInput[])[]) {
  const flat = interceptors.flat(Infinity);
  return function (_target: unknown, context: ClassMethodDecoratorContext | ClassDecoratorContext): void {
    if (context.kind === 'method') {
      const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
      pushMethodMiddleware(context.metadata, METHOD_INTERCEPTORS, handlerName, flat);
    } else if (context.kind === 'class') {
      pushClassMiddleware(context.metadata, CLASS_INTERCEPTORS, flat);
    }
  };
}

/** Decorate route methods or controllers with exception filters. */
export function UseFilters(...filters: readonly (FilterInput | readonly FilterInput[])[]) {
  const flat = filters.flat(Infinity);
  return function (_target: unknown, context: ClassMethodDecoratorContext | ClassDecoratorContext): void {
    if (context.kind === 'method') {
      const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
      pushMethodMiddleware(context.metadata, METHOD_FILTERS, handlerName, flat);
    } else if (context.kind === 'class') {
      pushClassMiddleware(context.metadata, CLASS_FILTERS, flat);
    }
  };
}

function isConstructor<T>(item: unknown): item is Constructor<T> {
  if (typeof item !== 'function') {
    return false;
  }
  const proto: unknown = Reflect.get(item, 'prototype');
  return proto !== undefined && proto !== null && Object.getOwnPropertyNames(proto).length > 0;
}

function instantiate<T>(item: T | Constructor<T>): T {
  if (isConstructor<T>(item)) {
    return new item();
  }
  return item;
}

function resolveMetadata(target: object): DecoratorMetadata | undefined {
  const meta: DecoratorMetadata | undefined = Reflect.get(target, Symbol.metadata);
  if (meta !== undefined && meta !== null) {
    return meta;
  }
  const ctor: unknown = Reflect.get(target, 'constructor');
  if (typeof ctor === 'function' || (typeof ctor === 'object' && ctor !== null)) {
    const ctorMeta: DecoratorMetadata | undefined = Reflect.get(ctor, Symbol.metadata);
    if (ctorMeta !== undefined && ctorMeta !== null) {
      return ctorMeta;
    }
  }
  return undefined;
}

/** Resolve the compiled Chain for a controller method, reading native Stage-3 metadata. */
export function getChain(target: object, handlerName?: string): Chain {
  const metadata = resolveMetadata(target);
  if (!metadata) {
    return { guards: [], pipes: [], interceptors: [], filters: [] };
  }

  const view = middlewareView(metadata);

  const classGuards = view[CLASS_GUARDS] ?? [];
  const classPipes = view[CLASS_PIPES] ?? [];
  const classInterceptors = view[CLASS_INTERCEPTORS] ?? [];
  const classFilters = view[CLASS_FILTERS] ?? [];

  const methodGuards = handlerName ? (view[METHOD_GUARDS]?.[handlerName] ?? []) : [];
  const methodPipes = handlerName ? (view[METHOD_PIPES]?.[handlerName] ?? []) : [];
  const methodInterceptors = handlerName ? (view[METHOD_INTERCEPTORS]?.[handlerName] ?? []) : [];
  const methodFilters = handlerName ? (view[METHOD_FILTERS]?.[handlerName] ?? []) : [];

  return {
    guards: [...classGuards, ...methodGuards].map(instantiate),
    pipes: [...classPipes, ...methodPipes].map(instantiate),
    interceptors: [...classInterceptors, ...methodInterceptors].map(instantiate),
    filters: [...classFilters, ...methodFilters].map(instantiate),
  };
}

/**
 * Run a middleware chain around `handler` for `ctx`. Order: guards → pipes (fold
 * the body) → interceptors (nested) → handler. A guard returning false throws
 * ChainError(403); an ordinary throwing pipe throws ChainError(400), while a
 * built-in boundary pipe can preserve its framework-selected status; a thrown
 * handler is offered to the exception filters — a matching filter's response is
 * returned, otherwise the error rethrows for the pipeline to serialize.
 */
export async function runChain(chain: Chain, ctx: AnyCtx, handler: ChainHandler): Promise<unknown> {
  // 1) guards
  for (const guard of chain.guards) {
    const allowed = await guard.canActivate(ctx);
    if (!allowed) {
      throw new ChainError(403, 'forbidden');
    }
  }

  // 2) pipes — fold over the body, producing a new ctx the handler sees.
  let body = ctx.body;
  for (const pipe of chain.pipes) {
    try {
      body = await pipe.transform(body, ctx);
    } catch (error) {
      if (error instanceof BoundaryStatusError) {
        throw error;
      }
      if (error instanceof ChainError) {
        throw error;
      }
      throw new ChainError(400, messageOf(error), error);
    }
  }
  const pipedCtx: AnyCtx = { ...ctx, body };

  // 3) interceptors — nest right-to-left so the first listed runs outermost.
  const invokeHandler = (): Promise<unknown> => Promise.resolve(handler(pipedCtx));
  let next = invokeHandler;
  for (let i = chain.interceptors.length - 1; i >= 0; i -= 1) {
    const interceptor = chain.interceptors[i];
    if (interceptor === undefined) {
      continue;
    }
    const downstream = next;
    next = (): Promise<unknown> => interceptor.intercept(pipedCtx, downstream);
  }

  // 4) handler (via the interceptor chain); 5) exception filters on throw.
  try {
    return await next();
  } catch (error) {
    for (const filter of chain.filters) {
      const response = filter.catch(error, pipedCtx);
      if (response !== undefined) {
        return response;
      }
    }
    throw error;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
