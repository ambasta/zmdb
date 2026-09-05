import { createToken } from '@zmdb/app/di';
import {
  EventPattern,
  MessagePattern,
  transportExtension,
  type DispatchOutcome,
  type MessageContext,
  type RawMessage,
  type TransportStrategy,
  type WithHeaders,
} from '@zmdb/app/messaging';
import { Module } from '@zmdb/app/modules';
// Tests (#294) for app bootstrap & lifecycle — RED first (app exports absent).
// createApp routes a request; init runs hooks in order; dispose runs onShutdown
// reversed. Per packages/web/src/app/SPEC.md.
import { describe, it, expect } from 'vitest';

import type { Ctx } from '../context/index.js';
import type { Guard } from '../middleware/index.js';
import { bodyText } from '../pipeline/index.js';
import { Controller, Get } from '../routing/index.js';
import { createApp, type OnModuleInit, type OnApplicationBootstrap, type OnShutdown } from './index.js';

const order: string[] = [];

@Controller('/ping')
class PingController implements OnModuleInit, OnApplicationBootstrap, OnShutdown {
  onModuleInit() {
    order.push('init');
  }
  onApplicationBootstrap() {
    order.push('bootstrap');
  }
  onShutdown() {
    order.push('shutdown');
  }
  @Get()
  ping(_ctx: Ctx) {
    return { pong: true };
  }
}

@Module({ controllers: [PingController] })
class AppModule {}

interface CapturingTransport extends TransportStrategy {
  dispatch: ((message: RawMessage) => Promise<DispatchOutcome>) | undefined;
}

function capturingTransport(): CapturingTransport {
  const transport: CapturingTransport = {
    name: 'capture',
    capabilities: { redelivery: true, deadLetter: true, requestResponse: true },
    dispatch: undefined,
    listen(dispatch) {
      transport.dispatch = dispatch;
      return Promise.resolve();
    },
    send: () => Promise.reject(new Error('unused')),
    emit: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return transport;
}

function message(pattern: string, payload: unknown, headers: Readonly<Record<string, string>> = {}): RawMessage {
  return {
    pattern,
    payload,
    headers,
    correlationId: undefined,
    replyTo: undefined,
    deliveryAttempt: 1,
  };
}

const dispatcher = {
  onUnhandled: () => undefined,
  onInvalidPayload: () => undefined,
  onHandlerError: () => undefined,
};

describe('@zmdb/web app: createApp', () => {
  it('routes a request to a module controller', async () => {
    const app = createApp(AppModule);
    const res = await app.handle({ method: 'GET', path: '/ping', headers: {} });
    expect(res.status).toBe(200);
    expect(JSON.parse(await bodyText(res))).toEqual({ pong: true });
  });

  it('runs init hooks in order and onShutdown on dispose (reversed)', async () => {
    order.length = 0;
    const app = createApp(AppModule);
    await app.init();
    expect(order).toEqual(['init', 'bootstrap']);
    await app[Symbol.asyncDispose]();
    expect(order).toEqual(['init', 'bootstrap', 'shutdown']);
  });

  it('handles via the Fetch adapter', async () => {
    const app = createApp(AppModule);
    const response = await app.fetch(new Request('http://x/ping'));
    expect(response.status).toBe(200);
  });

  it('serves HTTP and a transport from one process sharing one container', async () => {
    const seen: object[] = [];

    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        seen.push(this);
        return 'ok';
      }

      @MessagePattern('orders.get', orderId)
      get(ctx: MessageContext<number>): { readonly id: number } {
        seen.push(this);
        return { id: ctx.payload };
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const transport = capturingTransport();
    const app = createApp(Root, {
      extensions: [transportExtension({ transports: [transport], dispatcher })],
    });
    await app.init();
    const response = await app.handle({ method: 'GET', path: '/orders', headers: {} });
    const result = await transport.dispatch?.({
      ...message('orders.get', { id: 7 }),
      correlationId: 'c1',
      replyTo: 'reply:capture',
    });
    await app[Symbol.asyncDispose]();

    expect({
      http: response.status,
      sameInstance: seen.length === 2 && seen[0] === seen[1],
      result,
    }).toEqual({
      http: 200,
      sameInstance: true,
      result: {
        settlement: { kind: 'ack' },
        reply: { kind: 'result', correlationId: 'c1', payload: { id: 7 } },
      },
    });
  });

  it('one authorisation function written against WithHeaders serves an HTTP guard and a message handler', async () => {
    const requiresApiKey = (context: WithHeaders): boolean => context.headers['x-api-key'] === 'secret';
    const guard: Guard = { canActivate: context => requiresApiKey(context) };
    const checks: boolean[] = [];

    class Consumer {
      @EventPattern('orders.secured', orderId)
      secured(context: MessageContext<number>): void {
        checks.push(requiresApiKey(context));
      }
    }

    @Module({ controllers: [Consumer] })
    class Root {}

    const transport = capturingTransport();
    const app = createApp(Root, {
      extensions: [transportExtension({ transports: [transport], dispatcher })],
    });
    await app.init();
    const httpContext: Ctx = {
      params: {},
      body: undefined,
      query: {},
      headers: { 'x-api-key': 'secret' },
      method: 'GET',
      path: '/orders',
    };

    expect(await guard.canActivate(httpContext)).toBe(true);
    expect(await guard.canActivate({ ...httpContext, headers: {} })).toBe(false);
    await transport.dispatch?.(message('orders.secured', { id: 1 }, { 'x-api-key': 'secret' }));
    await transport.dispatch?.(message('orders.secured', { id: 2 }));
    await app[Symbol.asyncDispose]();

    expect(checks).toEqual([true, false]);
  });

  it('runs lifecycle hooks on non-controller providers', async () => {
    const providerOrder: string[] = [];

    class CacheService implements OnModuleInit, OnApplicationBootstrap, OnShutdown {
      onModuleInit() {
        providerOrder.push('cache:init');
      }
      onApplicationBootstrap() {
        providerOrder.push('cache:bootstrap');
      }
      onShutdown() {
        providerOrder.push('cache:shutdown');
      }
    }

    const CacheToken = createToken<CacheService>('Cache');

    @Module({
      providers: [{ token: CacheToken, useValue: new CacheService() }],
    })
    class ProviderAppModule {}

    await using app = createApp(ProviderAppModule);
    await app.init();
    expect(providerOrder).toEqual(['cache:init', 'cache:bootstrap']);
    await app[Symbol.asyncDispose]();
    expect(providerOrder).toEqual(['cache:init', 'cache:bootstrap', 'cache:shutdown']);
  });
});

function orderId(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
    throw new Error('id must be a number');
  }
  return raw.id;
}
