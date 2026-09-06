// Tests (#289) for guards/pipes/interceptors/filters — RED first (middleware
// exports absent). Order, short-circuit, transform, interceptor wrap, error
// mapping. Per packages/web/src/middleware/SPEC.md.
import { describe, it, expect } from 'vitest';

import type { Ctx } from '../context/index.js';
import { text, createRouter, bodyText } from '../pipeline/index.js';
import { Controller, Get, Post } from '../routing/index.js';
import {
  runChain,
  UseGuards,
  UsePipes,
  UseInterceptors,
  UseFilters,
  getChain,
  type Guard,
  type Pipe,
  type Interceptor,
  type ExceptionFilter,
  type Chain,
} from './index.js';

function ctxWith(body: unknown): Ctx<Record<string, string>, unknown> {
  return { params: {}, body, query: {}, headers: {}, method: 'POST', path: '/' };
}

describe('@zmdb/web middleware: chain', () => {
  it('runs guard → pipe → interceptor(before) → handler → interceptor(after)', async () => {
    const order: string[] = [];
    const guard: Guard = {
      canActivate: () => {
        order.push('guard');
        return true;
      },
    };
    const pipe: Pipe = {
      transform: v => {
        order.push('pipe');
        return v;
      },
    };
    const interceptor: Interceptor = {
      async intercept(_ctx, next) {
        order.push('before');
        const r = await next();
        order.push('after');
        return r;
      },
    };
    const chain: Chain = { guards: [guard], pipes: [pipe], interceptors: [interceptor], filters: [] };
    const result = await runChain(chain, ctxWith({ n: 1 }), () => {
      order.push('handler');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(order).toEqual(['guard', 'pipe', 'before', 'handler', 'after']);
  });

  it('short-circuits with ChainError(403) when a guard returns false', async () => {
    const guard: Guard = { canActivate: () => false };
    const chain: Chain = { guards: [guard], pipes: [], interceptors: [], filters: [] };
    let handlerRan = false;
    await expect(
      runChain(chain, ctxWith({}), () => {
        handlerRan = true;
        return 'x';
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(handlerRan).toBe(false);
  });

  it('a throwing pipe raises ChainError(400)', async () => {
    const pipe: Pipe = {
      transform: () => {
        throw new Error('bad');
      },
    };
    const chain: Chain = { guards: [], pipes: [pipe], interceptors: [], filters: [] };
    await expect(runChain(chain, ctxWith({}), () => 'x')).rejects.toMatchObject({ status: 400 });
  });

  it('a matching exception filter maps a thrown handler error', async () => {
    const filter: ExceptionFilter = {
      catch: error => text(JSON.stringify({ teapot: String(error) }), { status: 418 }),
    };
    const chain: Chain = { guards: [], pipes: [], interceptors: [], filters: [filter] };
    const result = await runChain(chain, ctxWith({}), () => {
      throw new Error('boom');
    });
    expect(result).toMatchObject({ status: 418 });
  });

  it('pipes fold the body left-to-right', async () => {
    const p1: Pipe<{ n: number }, { n: number }> = { transform: v => ({ n: v.n + 1 }) };
    const p2: Pipe<{ n: number }, { n: number }> = { transform: v => ({ n: v.n * 10 }) };
    const chain: Chain = { guards: [], pipes: [p1, p2], interceptors: [], filters: [] };
    const result = await runChain(chain, ctxWith({ n: 1 }), ctx => ctx.body);
    expect(result).toEqual({ n: 20 }); // (1+1)*10
  });
});

describe('@zmdb/web middleware: stage-3 decorators', () => {
  class ClassGuard implements Guard {
    canActivate() {
      return true;
    }
  }

  class RejectGuard implements Guard {
    canActivate() {
      return false;
    }
  }

  class TransformPipe implements Pipe<{ val: number }, { val: number }> {
    transform(value: { val: number }) {
      return { val: value.val * 2 };
    }
  }

  class ThrowPipe implements Pipe {
    transform() {
      throw new Error('invalid input payload');
    }
  }

  class WrapInterceptor implements Interceptor {
    async intercept(_ctx: Ctx<Record<string, string>, unknown>, next: () => Promise<unknown>) {
      const res = await next();
      return { wrapped: res };
    }
  }

  class TeapotFilter implements ExceptionFilter {
    catch(error: unknown) {
      if (error instanceof Error && error.message === 'teapot error') {
        return text(JSON.stringify({ message: 'I am a teapot' }), { status: 418 });
      }
      return undefined;
    }
  }

  @Controller('/api')
  @UseGuards(ClassGuard)
  class ApiController {
    @Get('/protected')
    @UseGuards(RejectGuard)
    protectedRoute() {
      return { secret: 'data' };
    }

    @Get('/open')
    openRoute() {
      return { public: 'data' };
    }

    @Post('/transform')
    @UsePipes(TransformPipe)
    transformRoute(ctx: Ctx<Record<string, string>, { val: number }>) {
      return ctx.body;
    }

    @Post('/bad-pipe')
    @UsePipes(ThrowPipe)
    badPipeRoute() {
      return { ok: true };
    }

    @Get('/wrap')
    @UseInterceptors(WrapInterceptor)
    wrapRoute() {
      return { msg: 'hello' };
    }

    @Get('/filter')
    @UseFilters(TeapotFilter)
    filterRoute() {
      throw new Error('teapot error');
    }
  }

  it('extracts chain from decorated controller methods using getChain', () => {
    const chain = getChain(ApiController, 'protectedRoute');
    expect(chain.guards).toHaveLength(2); // ClassGuard + RejectGuard
  });

  it('evaluates @UseGuards prior to handler and returns HTTP 403 on failure', async () => {
    const router = createRouter();
    router.register(new ApiController());

    const resForbidden = await router.handle({ method: 'GET', path: '/api/protected', headers: {} });
    expect(resForbidden.status).toBe(403);
    expect(JSON.parse(await bodyText(resForbidden))).toEqual({ error: 'forbidden' });

    const resOpen = await router.handle({ method: 'GET', path: '/api/open', headers: {} });
    expect(resOpen.status).toBe(200);
    expect(JSON.parse(await bodyText(resOpen))).toEqual({ public: 'data' });
  });

  it('transforms payload with @UsePipes and returns 400 on pipe validation failure', async () => {
    const router = createRouter();
    router.register(new ApiController());

    const resOk = await router.handle({ method: 'POST', path: '/api/transform', headers: {}, rawBody: { val: 5 } });
    expect(resOk.status).toBe(200);
    expect(JSON.parse(await bodyText(resOk))).toEqual({ val: 10 });

    const resErr = await router.handle({ method: 'POST', path: '/api/bad-pipe', headers: {}, rawBody: {} });
    expect(resErr.status).toBe(400);
    expect(JSON.parse(await bodyText(resErr))).toEqual({ error: 'invalid input payload' });
  });

  it('wraps handler result with @UseInterceptors', async () => {
    const router = createRouter();
    router.register(new ApiController());

    const res = await router.handle({ method: 'GET', path: '/api/wrap', headers: {} });
    expect(res.status).toBe(200);
    expect(JSON.parse(await bodyText(res))).toEqual({ wrapped: { msg: 'hello' } });
  });

  it('catches thrown pipeline errors with @UseFilters and formats error response', async () => {
    const router = createRouter();
    router.register(new ApiController());

    const res = await router.handle({ method: 'GET', path: '/api/filter', headers: {} });
    expect(res.status).toBe(418);
    expect(JSON.parse(await bodyText(res))).toEqual({ message: 'I am a teapot' });
  });
});
