// Tests (#319) for router benchmark & perf verification — RED first (bench
// exports absent). Init-time-resolution regression guard + microbench smoke.
// Per packages/web/src/bench/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Module } from '../modules/index.js';
import { createRouter } from '../pipeline/index.js';
import { Controller, Get } from '../routing/index.js';
import { benchmarkAppStartup, benchmarkRouter, countMetadataReads } from './index.js';

@Controller('/x')
class XController {
  @Get('/:id')
  get() {
    return { ok: true };
  }
}

@Module({ controllers: [XController] })
class XModule {}

describe('@zmdb/web bench: init-time resolution', () => {
  it('reads controller metadata only at register, not per handle', async () => {
    const counter = countMetadataReads(XController);
    const router = createRouter();
    router.register(new XController());
    const afterRegister = counter.count();
    expect(afterRegister).toBeGreaterThan(0); // resolved once at register

    for (let i = 0; i < 50; i += 1) {
      await router.handle({ method: 'GET', path: '/x/1', headers: {} });
    }
    expect(counter.count()).toBe(afterRegister); // zero additional reads per request
    counter.restore();
  });
});

describe('@zmdb/web bench: microbench', () => {
  it('returns a positive opsPerSec for a small route set (smoke)', async () => {
    const result = await benchmarkRouter({ routes: 5, iters: 200 });
    expect(result.iters).toBe(200);
    expect(result.opsPerSec).toBeGreaterThan(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('returns raw timings for repeated eager app creation', () => {
    const result = benchmarkAppStartup(XModule, 200);
    expect(result.iters).toBe(200);
    expect(result.opsPerSec).toBeGreaterThan(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });
});
