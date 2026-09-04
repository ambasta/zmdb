// Tests (#314) for testing utilities — RED first (testing exports absent).
// createTestApp applies overrides, drives requests in-process, exposes get.
// Per packages/web/src/testing/SPEC.md.
import { describe, it, expect } from 'vitest';

import type { Ctx } from '../context/index.js';
import { createToken, Inject } from '../di/index.js';
import { Module } from '../modules/index.js';
import { Controller, Get } from '../routing/index.js';
import { createTestApp } from './index.js';

interface Greeter {
  greet(): string;
}
const GreeterToken = createToken<Greeter>('Greeter');

class RealGreeter implements Greeter {
  greet() {
    return 'real';
  }
}

@Controller('/hello')
class HelloController {
  @Inject(GreeterToken)
  greeter!: Greeter;
  @Get()
  hello(_ctx: Ctx) {
    return { msg: this.greeter.greet() };
  }
}

@Module({ controllers: [HelloController], providers: [{ token: GreeterToken, useValue: new RealGreeter() }] })
class AppModule {}

describe('@zmdb/web testing: createTestApp', () => {
  it('drives a request in-process', async () => {
    const app = createTestApp(AppModule);
    const res = await app.request({ method: 'GET', path: '/hello', headers: {} });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ msg: 'real' });
  });

  it('applies a provider override (stub is injected)', async () => {
    const stub: Greeter = { greet: () => 'stubbed' };
    const app = createTestApp(AppModule, { overrides: [{ token: GreeterToken, useValue: stub }] });
    const res = await app.request({ method: 'GET', path: '/hello', headers: {} });
    expect(JSON.parse(res.body)).toEqual({ msg: 'stubbed' });
    expect(app.get(GreeterToken)).toBe(stub);
  });

  // SPEC.md: "lifecycle, same as App" — every hook createApp runs, in the same
  // order, so a test can exercise startup work rather than only routes.
  it('runs the same lifecycle hooks as createApp, in order', async () => {
    const calls: string[] = [];

    @Controller('/lifecycle')
    class LifecycleController {
      onModuleInit() {
        calls.push('init');
      }
      onApplicationBootstrap() {
        calls.push('bootstrap');
      }
      onShutdown() {
        calls.push('shutdown');
      }
      @Get()
      get(_ctx: Ctx) {
        return {};
      }
    }

    @Module({ controllers: [LifecycleController] })
    class LifecycleModule {}

    {
      await using app = createTestApp(LifecycleModule);
      await app.init();
      expect(calls).toEqual(['init', 'bootstrap']);
    }
    expect(calls).toEqual(['init', 'bootstrap', 'shutdown']);
  });
});
