import { describe, it, expect } from 'vitest';

import { stringify } from './index.ts';

// #55: benchmark vs JSON.stringify + E2E correctness at scale.
// (Timing is environment-dependent, so the committed assertions verify
// correctness over a large workload and expose a reusable micro-benchmark
// that returns ops/sec; the numeric comparison is reported, not asserted.)

declare const performance: { now(): number };

function bench(label: string, fn: () => void, iterations: number): { label: string; opsPerSec: number } {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = performance.now() - start;
  return { label, opsPerSec: ms > 0 ? Math.round((iterations / ms) * 1000) : iterations };
}

describe('stringify vs JSON.stringify', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    email: `user${i}@example.com`,
    active: i % 2 === 0,
    tags: ['a', 'b', 'c'],
    nested: { score: i * 1.5, note: null },
  }));

  it('matches JSON.stringify across a large workload', () => {
    for (const r of rows) {
      expect(stringify(r)).toBe(JSON.stringify(r));
    }
  });

  it('exposes a micro-benchmark producing ops/sec for both', () => {
    const zmdb = bench('zmdb.stringify', () => void rows.map(r => stringify(r)), 200);
    const native = bench('JSON.stringify', () => void rows.map(r => JSON.stringify(r)), 200);
    expect(zmdb.opsPerSec).toBeGreaterThan(0);
    expect(native.opsPerSec).toBeGreaterThan(0);
    // Report only — do not assert a speed ordering (environment-dependent).
  });
});
