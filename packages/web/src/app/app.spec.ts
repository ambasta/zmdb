// Tests (#294) for app bootstrap & lifecycle — RED first (app exports absent).
// createApp routes a request; init runs hooks in order; dispose runs onShutdown
// reversed. Per packages/web/src/app/SPEC.md.
import { describe, it, expect } from 'vitest';

import type { Ctx } from '../context/index.ts';
import { Module } from '../modules/index.ts';
import { Controller, Get } from '../routing/index.ts';
import { createApp, type OnModuleInit, type OnApplicationBootstrap, type OnShutdown } from './index.ts';

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

describe('@zmdb/web app: createApp', () => {
  it('routes a request to a module controller', async () => {
    const app = createApp(AppModule);
    const res = await app.handle({ method: 'GET', path: '/ping', headers: {} });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ pong: true });
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
});
