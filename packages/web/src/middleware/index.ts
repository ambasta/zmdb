// @zmdb/web — guards, pipes, interceptors & exception filters (epic #287, spec
// ./SPEC.md). A Chain composes middleware around a handler in deterministic
// order. Static composition, no reflection, no `as` on the consumer surface.

import '@zmdb/app';
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

export type GuardInput = Guard | (new (...args: never[]) => Guard);
export type PipeInput = Pipe | (new (...args: never[]) => Pipe);
export type InterceptorInput = Interceptor | (new (...args: never[]) => Interceptor);
export type FilterInput = ExceptionFilter | (new (...args: never[]) => ExceptionFilter);

const GUARDS_METADATA = Symbol('zmdb.web.middleware.guards');
const PIPES_METADATA = Symbol('zmdb.web.middleware.pipes');
const INTERCEPTORS_METADATA = Symbol('zmdb.web.middleware.interceptors');
const FILTERS_METADATA = Symbol('zmdb.web.middleware.filters');

interface MiddlewareMetadataSlot<T> {
  classItems?: T[];
  methodItems?: Record<string, T[]>;
}

function isSlot<T>(value: unknown): value is MiddlewareMetadataSlot<T> {
  return typeof value === 'object' && value !== null;
}

// boundary: metadata slots are stored under private symbol keys on DecoratorMetadata
function getSlot<T>(metadata: DecoratorMetadata, key: symbol): MiddlewareMetadataSlot<T> {
  const raw = metadata[key];
  if (isSlot<T>(raw)) {
    return raw;
  }
  const slot: MiddlewareMetadataSlot<T> = {};
  metadata[key] = slot;
  return slot;
}

function pushClassMiddleware<T>(metadata: DecoratorMetadata, key: symbol, items: readonly T[]): void {
  const slot = getSlot<T>(metadata, key);
  if (slot.classItems === undefined) {
    slot.classItems = [...items];
  } else {
    slot.classItems.push(...items);
  }
}

function pushMethodMiddleware<T>(
  metadata: DecoratorMetadata,
  key: symbol,
  handlerName: string,
  items: readonly T[],
): void {
  const slot = getSlot<T>(metadata, key);
  if (slot.methodItems === undefined) {
    slot.methodItems = {};
  }
  const existing = slot.methodItems[handlerName];
  if (existing === undefined) {
    slot.methodItems[handlerName] = [...items];
  } else {
    existing.push(...items);
  }
}

function createMiddlewareDecorator<TInput>(key: symbol) {
  return function (...items: readonly TInput[]) {
    return function (_target: unknown, context: ClassDecoratorContext | ClassMethodDecoratorContext): void {
      if (context.kind === 'class') {
        pushClassMiddleware(context.metadata, key, items);
      } else if (context.kind === 'method') {
        const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
        pushMethodMiddleware(context.metadata, key, handlerName, items);
      }
    };
  };
}

/** Stage-3 decorator to attach guards to a controller class or route handler method. */
export const UseGuards = createMiddlewareDecorator<GuardInput>(GUARDS_METADATA);

/** Stage-3 decorator to attach pipes to a controller class or route handler method. */
export const UsePipes = createMiddlewareDecorator<PipeInput>(PIPES_METADATA);

/** Stage-3 decorator to attach interceptors to a controller class or route handler method. */
export const UseInterceptors = createMiddlewareDecorator<InterceptorInput>(INTERCEPTORS_METADATA);

/** Stage-3 decorator to attach exception filters to a controller class or route handler method. */
export const UseFilters = createMiddlewareDecorator<FilterInput>(FILTERS_METADATA);

function isConstructor<T>(item: unknown): item is new (...args: never[]) => T {
  return typeof item === 'function';
}

function instantiate<T>(item: T | (new (...args: never[]) => T)): T {
  if (isConstructor<T>(item)) {
    return new item();
  }
  return item;
}

function resolveMiddleware<Input extends Output | (new (...args: never[]) => Output), Output>(
  metadata: DecoratorMetadata,
  key: symbol,
  handlerName: string,
  combine: (classItems: readonly Output[], methodItems: readonly Output[]) => Output[],
): readonly Output[] {
  const slot = getSlot<Input>(metadata, key);
  const rawClass = slot.classItems ?? [];
  const rawMethod = slot.methodItems?.[handlerName] ?? [];

  const classInstances: Output[] = rawClass.map(item => instantiate<Output>(item));
  const methodInstances: Output[] = rawMethod.map(item => instantiate<Output>(item));

  return combine(classInstances, methodInstances);
}

/**
 * Read a controller class's metadata and compile an immutable middleware chain
 * for a given handler method. Performed at router registration time (startup).
 */
export function compileRouteChain(
  controllerCtor: abstract new (...args: never[]) => unknown,
  handlerName: string,
): Chain {
  const metadata = controllerCtor[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return { guards: [], pipes: [], interceptors: [], filters: [] };
  }

  const guards = resolveMiddleware<GuardInput, Guard>(
    metadata,
    GUARDS_METADATA,
    handlerName,
    (classGuards, methodGuards) => [...classGuards, ...methodGuards],
  );

  const pipes = resolveMiddleware<PipeInput, Pipe>(metadata, PIPES_METADATA, handlerName, (classPipes, methodPipes) => [
    ...classPipes,
    ...methodPipes,
  ]);

  const interceptors = resolveMiddleware<InterceptorInput, Interceptor>(
    metadata,
    INTERCEPTORS_METADATA,
    handlerName,
    (classInterceptors, methodInterceptors) => [...classInterceptors, ...methodInterceptors],
  );

  const filters = resolveMiddleware<FilterInput, ExceptionFilter>(
    metadata,
    FILTERS_METADATA,
    handlerName,
    (classFilters, methodFilters) => [...methodFilters, ...classFilters],
  );

  return { guards, pipes, interceptors, filters };
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
  try {
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
        if (
          error instanceof BoundaryStatusError ||
          error instanceof ChainError ||
          (error &&
            typeof error === 'object' &&
            ('issues' in error || ('name' in error && error.name === 'ValidationError')))
        ) {
          throw error;
        }
        throw new ChainError(400, messageOf(error));
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
    return await next();
  } catch (error) {
    for (const filter of chain.filters) {
      const response = filter.catch(error, ctx);
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
