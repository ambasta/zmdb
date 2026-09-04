// @zmdb/web — guards, pipes, interceptors & exception filters (epic #287, spec
// ./SPEC.md). A Chain composes middleware around a handler in deterministic
// order. Static composition, no reflection, no `as` on the consumer surface.

import type { Ctx, QueryValues } from '../context/index.js';
import type { WebResponse } from '../pipeline/index.js';
import { middlewareFor } from '../routing/index.js';
import { BoundaryStatusError, ChainError } from './errors.js';

export { ChainError } from './errors.js';
export { UseGuards, UsePipes, UseInterceptors, UseFilters, middlewareFor } from '../routing/index.js';

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

/** Resolve the compiled Chain for a controller method, reading native Stage-3 metadata. */
export function getChain(target: object, handlerName?: string): Chain {
  const ctor =
    typeof target === 'function'
      ? (target as abstract new (...args: never[]) => unknown)
      : (target.constructor as abstract new (...args: never[]) => unknown);
  const instance = typeof target === 'function' ? Object.create((target as Function).prototype) : target;
  return middlewareFor(instance, ctor, handlerName ?? '');
}

/**
 * Run a middleware chain around `handler` for `ctx`. Order: guards → pipes (fold
 * the body) → interceptors (nested) → handler. A guard returning false throws
 * ChainError(403); an ordinary throwing pipe throws ChainError(400), while a
 * built-in boundary pipe can preserve its framework-selected status; a thrown
 * handler is offered to the exception filters — a matching filter's response is
 * returned, otherwise the error rethrows for the pipeline to serialize.
 */
export function composeChain(chain: Chain, handler: ChainHandler): ChainHandler {
  if (chain.guards.length + chain.pipes.length + chain.interceptors.length + chain.filters.length === 0) return handler;
  let invoke: (ctx: AnyCtx) => Promise<unknown> = async ctx => handler(ctx);
  for (let index = chain.interceptors.length - 1; index >= 0; index -= 1) {
    const interceptor = chain.interceptors[index];
    if (interceptor === undefined) continue;
    const downstream = invoke;
    invoke = ctx => interceptor.intercept(ctx, () => downstream(ctx));
  }
  return async ctx => {
    for (const guard of chain.guards) {
      if (!(await guard.canActivate(ctx))) throw new ChainError(403, 'forbidden');
    }
    let body = ctx.body;
    for (const pipe of chain.pipes) {
      try {
        body = await pipe.transform(body, ctx);
      } catch (error) {
        if (error instanceof BoundaryStatusError) throw error;
        throw new ChainError(400, messageOf(error));
      }
    }
    const pipedCtx = chain.pipes.length === 0 ? ctx : { ...ctx, body };
    try {
      return await invoke(pipedCtx);
    } catch (error) {
      for (const filter of chain.filters) {
        const response = filter.catch(error, pipedCtx);
        if (response !== undefined) return response;
      }
      throw error;
    }
  };
}

export async function runChain(chain: Chain, ctx: AnyCtx, handler: ChainHandler): Promise<unknown> {
  return composeChain(chain, handler)(ctx);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
