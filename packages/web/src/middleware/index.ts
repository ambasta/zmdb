// @zmdb/web — guards, pipes, interceptors & exception filters (epic #287, spec
// ./SPEC.md). A Chain composes middleware around a handler in deterministic
// order. Static composition, no reflection, no `as` on the consumer surface.

import type { Ctx, QueryValues } from '../context/index.js';
import type { WebResponse } from '../pipeline/index.js';

type AnyCtx = Ctx<Record<string, string>, unknown, QueryValues>;

/** Authorization gate: a `false` short-circuits the request (403). */
export interface Guard {
  canActivate(ctx: AnyCtx): boolean | Promise<boolean>;
}

/** Transform/validate a value (typically the body); a throw yields 400. */
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

/** An error carrying an HTTP status, thrown when the chain short-circuits. */
export class ChainError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChainError';
    this.status = status;
  }
}

/** A handler invoked with the (piped) ctx. */
export type ChainHandler = (ctx: AnyCtx) => unknown;

/**
 * Run a middleware chain around `handler` for `ctx`. Order: guards → pipes (fold
 * the body) → interceptors (nested) → handler. A guard returning false throws
 * ChainError(403); a throwing pipe throws ChainError(400); a thrown handler is
 * offered to the exception filters — a matching filter's response is returned,
 * otherwise the error rethrows for the pipeline to serialize.
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
