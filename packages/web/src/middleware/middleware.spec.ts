// Tests (#289) for guards/pipes/interceptors/filters — RED first (middleware
// exports absent). Order, short-circuit, transform, interceptor wrap, error
// mapping. Per packages/web/src/middleware/SPEC.md.
import { describe, it, expect } from 'vitest';

import { countMetadataReads } from '../bench/index.js';
import type { Ctx } from '../context/index.js';
import { bodyText, createRouter, respond, text } from '../pipeline/index.js';
import { Controller, Get, Post } from '../routing/index.js';
import {
  runChain,
  compileRouteChain,
  UseGuards,
  UsePipes,
  UseInterceptors,
  UseFilters,
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

describe('@zmdb/web middleware decorators & startup chain compilation', () => {
  it('compiles class and method decorator metadata into execution chain at startup', () => {
    class ClassGuard implements Guard {
      canActivate() {
        return true;
      }
    }
    class MethodGuard implements Guard {
      canActivate() {
        return true;
      }
    }
    class ClassPipe implements Pipe {
      transform(v: unknown) {
        return v;
      }
    }
    class MethodPipe implements Pipe {
      transform(v: unknown) {
        return v;
      }
    }

    @UseGuards(ClassGuard)
    @UsePipes(ClassPipe)
    @Controller('/test')
    class TestController {
      @UseGuards(MethodGuard)
      @UsePipes(MethodPipe)
      @Get('/item')
      getItem() {
        return { ok: true };
      }
    }

    const chain = compileRouteChain(TestController, 'getItem');
    expect(chain.guards).toHaveLength(2);
    expect(chain.guards[0]).toBeInstanceOf(ClassGuard);
    expect(chain.guards[1]).toBeInstanceOf(MethodGuard);

    expect(chain.pipes).toHaveLength(2);
    expect(chain.pipes[0]).toBeInstanceOf(ClassPipe);
    expect(chain.pipes[1]).toBeInstanceOf(MethodPipe);
  });

  it('executes decorated middleware chain through router dispatches with zero request metadata lookups', async () => {
    const executionOrder: string[] = [];

    class AuthGuard implements Guard {
      canActivate(ctx: Ctx) {
        executionOrder.push('class-guard');
        return ctx.headers['authorization'] === 'Bearer token';
      }
    }

    class MethodGuard implements Guard {
      canActivate() {
        executionOrder.push('method-guard');
        return true;
      }
    }

    class InputPipe implements Pipe {
      transform(value: unknown) {
        executionOrder.push('pipe');
        if (!value || typeof value !== 'object') {
          throw new Error('Invalid body');
        }
        return { ...value, validated: true };
      }
    }

    class TransformInterceptor implements Interceptor {
      async intercept(_ctx: Ctx, next: () => Promise<unknown>) {
        executionOrder.push('interceptor-before');
        const res = await next();
        executionOrder.push('interceptor-after');
        return { ...(res as object), intercepted: true };
      }
    }

    class CustomExceptionFilter implements ExceptionFilter {
      catch(error: unknown) {
        executionOrder.push('filter');
        if (error instanceof Error && error.message === 'Boom') {
          return respond({
            status: 422,
            body: JSON.stringify({ customError: error.message }),
            headers: { 'content-type': 'application/json' },
          });
        }
      }
    }

    @UseGuards(AuthGuard)
    @UseFilters(CustomExceptionFilter)
    @Controller('/api')
    class ApiController {
      @UseGuards(MethodGuard)
      @UsePipes(InputPipe)
      @UseInterceptors(TransformInterceptor)
      @Post('/action')
      action(ctx: Ctx) {
        executionOrder.push('handler');
        const body = ctx.body as { fail?: boolean };
        if (body.fail) {
          throw new Error('Boom');
        }
        return { success: true, payload: ctx.body };
      }
    }

    const counter = countMetadataReads(ApiController);
    const router = createRouter();
    router.register(new ApiController());

    const readsAfterRegister = counter.count();
    expect(readsAfterRegister).toBeGreaterThan(0);

    // 1) Rejection via Guard -> 403
    executionOrder.length = 0;
    const res1 = await router.handle({
      method: 'POST',
      path: '/api/action',
      headers: {},
      rawBody: { test: 1 },
    });
    expect(res1.status).toBe(403);
    expect(JSON.parse(await bodyText(res1))).toEqual({ error: 'forbidden' });
    expect(executionOrder).toEqual(['class-guard', 'filter']);

    // 2) Pipe validation failure -> 400
    executionOrder.length = 0;
    const res2 = await router.handle({
      method: 'POST',
      path: '/api/action',
      headers: { authorization: 'Bearer token' },
      rawBody: null,
    });
    expect(res2.status).toBe(400);
    expect(JSON.parse(await bodyText(res2))).toEqual({ error: 'Invalid body' });
    expect(executionOrder).toEqual(['class-guard', 'method-guard', 'pipe', 'filter']);

    // 3) Successful end-to-end execution
    executionOrder.length = 0;
    const res3 = await router.handle({
      method: 'POST',
      path: '/api/action',
      headers: { authorization: 'Bearer token' },
      rawBody: { foo: 'bar' },
    });
    expect(res3.status).toBe(200);
    expect(JSON.parse(await bodyText(res3))).toEqual({
      success: true,
      payload: { foo: 'bar', validated: true },
      intercepted: true,
    });
    expect(executionOrder).toEqual([
      'class-guard',
      'method-guard',
      'pipe',
      'interceptor-before',
      'handler',
      'interceptor-after',
    ]);

    // 4) Exception filter captures uncaught handler error -> 422
    executionOrder.length = 0;
    const res4 = await router.handle({
      method: 'POST',
      path: '/api/action',
      headers: { authorization: 'Bearer token' },
      rawBody: { fail: true },
    });
    expect(res4.status).toBe(422);
    expect(JSON.parse(await bodyText(res4))).toEqual({ customError: 'Boom' });
    expect(executionOrder).toEqual(['class-guard', 'method-guard', 'pipe', 'interceptor-before', 'handler', 'filter']);

    // Zero metadata reflection lookups during request dispatches
    expect(counter.count()).toBe(readsAfterRegister);
    counter.restore();
  });
});
