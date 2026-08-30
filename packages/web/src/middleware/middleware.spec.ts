// Tests (#289) for guards/pipes/interceptors/filters — RED first (middleware
// exports absent). Order, short-circuit, transform, interceptor wrap, error
// mapping. Per packages/web/src/middleware/SPEC.md.
import { describe, it, expect } from 'vitest';
import type { Ctx } from '../context/index.ts';
import {
  runChain,
  ChainError,
  type Guard,
  type Pipe,
  type Interceptor,
  type ExceptionFilter,
  type Chain,
} from './index.ts';

function ctxWith(body: unknown): Ctx<Record<string, string>, unknown> {
  return { params: {}, body, query: {}, headers: {}, method: 'POST', path: '/' };
}

describe('@zmdb/web middleware: chain', () => {
  it('runs guard → pipe → interceptor(before) → handler → interceptor(after)', async () => {
    const order: string[] = [];
    const guard: Guard = { canActivate: () => { order.push('guard'); return true; } };
    const pipe: Pipe = { transform: (v) => { order.push('pipe'); return v; } };
    const interceptor: Interceptor = {
      async intercept(_ctx, next) {
        order.push('before');
        const r = await next();
        order.push('after');
        return r;
      },
    };
    const chain: Chain = { guards: [guard], pipes: [pipe], interceptors: [interceptor], filters: [] };
    const result = await runChain(chain, ctxWith({ n: 1 }), () => { order.push('handler'); return 'ok'; });
    expect(result).toBe('ok');
    expect(order).toEqual(['guard', 'pipe', 'before', 'handler', 'after']);
  });

  it('short-circuits with ChainError(403) when a guard returns false', async () => {
    const guard: Guard = { canActivate: () => false };
    const chain: Chain = { guards: [guard], pipes: [], interceptors: [], filters: [] };
    let handlerRan = false;
    await expect(
      runChain(chain, ctxWith({}), () => { handlerRan = true; return 'x'; }),
    ).rejects.toMatchObject({ status: 403 });
    expect(handlerRan).toBe(false);
  });

  it('a throwing pipe raises ChainError(400)', async () => {
    const pipe: Pipe = { transform: () => { throw new Error('bad'); } };
    const chain: Chain = { guards: [], pipes: [pipe], interceptors: [], filters: [] };
    await expect(runChain(chain, ctxWith({}), () => 'x')).rejects.toMatchObject({ status: 400 });
  });

  it('a matching exception filter maps a thrown handler error', async () => {
    const filter: ExceptionFilter = {
      catch: (error) => ({ status: 418, body: JSON.stringify({ teapot: String(error) }), headers: {} }),
    };
    const chain: Chain = { guards: [], pipes: [], interceptors: [], filters: [filter] };
    const result = await runChain(chain, ctxWith({}), () => { throw new Error('boom'); });
    expect(result).toMatchObject({ status: 418 });
  });

  it('pipes fold the body left-to-right', async () => {
    const p1: Pipe<{ n: number }, { n: number }> = { transform: (v) => ({ n: v.n + 1 }) };
    const p2: Pipe<{ n: number }, { n: number }> = { transform: (v) => ({ n: v.n * 10 }) };
    const chain: Chain = { guards: [], pipes: [p1, p2], interceptors: [], filters: [] };
    const result = await runChain(chain, ctxWith({ n: 1 }), (ctx) => ctx.body);
    expect(result).toEqual({ n: 20 }); // (1+1)*10
  });
});
