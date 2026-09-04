// Tests (#319) for router benchmark & perf verification — RED first (bench
// exports absent). Init-time-resolution regression guard + microbench smoke.
// Per packages/web/src/bench/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Module } from '../modules/index.js';
import type { Observability, Span, SpanContext } from '../observability/index.js';
import { createRouter } from '../pipeline/index.js';
import { Controller, Get } from '../routing/index.js';
import { benchmarkAppStartup, benchmarkObservability, benchmarkRouter, countMetadataReads } from './index.js';

@Controller('/x')
class XController {
  @Get('/:id')
  get() {
    return { ok: true };
  }
}

@Module({ controllers: [XController] })
class XModule {}

const BENCH_CONTEXT: SpanContext = {
  traceId: '00000000000000000000000000000001',
  spanId: '0000000000000001',
  traceFlags: 1,
};

const BENCH_SPAN: Span = {
  updateName: () => undefined,
  setAttribute: () => undefined,
  recordException: () => undefined,
  setStatus: () => undefined,
  end: () => undefined,
  spanContext: () => BENCH_CONTEXT,
};

const NOOP_OBSERVABILITY: Observability = {
  tracer: { startSpan: () => BENCH_SPAN },
};

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

  it('measures path, header and media-type routing with the same workload', async () => {
    const results = await Promise.all([
      benchmarkRouter({
        routes: 5,
        iters: 200,
        version: '1',
        versioning: { kind: 'path', prefix: 'v' },
      }),
      benchmarkRouter({
        routes: 5,
        iters: 200,
        version: '1',
        versioning: { kind: 'header', name: 'accept-version', default: '1' },
      }),
      benchmarkRouter({
        routes: 5,
        iters: 200,
        version: '1',
        versioning: { kind: 'media-type', key: 'version', default: '1' },
      }),
    ]);
    expect(results.map(result => result.iters)).toEqual([200, 200, 200]);
    expect(results.every(result => result.opsPerSec > 0)).toBe(true);
  });

  it('returns raw timings for repeated eager app creation', () => {
    const result = benchmarkAppStartup(XModule, 200);
    expect(result.iters).toBe(200);
    expect(result.opsPerSec).toBeGreaterThan(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('measures request and query workloads with consumed results', async () => {
    for (const workload of ['request', 'query'] as const) {
      const off = await benchmarkObservability({ mode: 'off', workload, iters: 20 });
      const noop = await benchmarkObservability({
        mode: 'noop',
        workload,
        iters: 20,
        observability: NOOP_OBSERVABILITY,
      });

      expect(off.workload).toBe(workload);
      expect(off.iters).toBe(20);
      expect(off.opsPerSec).toBeGreaterThan(0);
      expect(off.totalMs).toBeGreaterThanOrEqual(0);
      expect(off.checksum).toBeGreaterThan(0);
      expect(noop.checksum).toBe(off.checksum);
    }
  });
});
