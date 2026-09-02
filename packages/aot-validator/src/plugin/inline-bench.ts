// The timing helper the AOT plugin benchmarks share.
//
// Both #82 (the build produces a working inlined validator) and #83 (the acceptance gate)
// time the emitted check against the runtime walker. Each used to carry its own copy of the
// loop, so a change to how "ops/sec" is measured would have had to be made twice for the
// two numbers to stay comparable.
//
// Building the validator no longer lives here. It used to, back when the transform was a
// text parser that needed nothing but a string; now it needs a compiler, and the project
// harness in `emit/__testing__/project.ts` is what owns that.

declare const performance: { now(): number };

/** Ops/sec for `fn` over `n` iterations, after a 10k-iteration warm-up. */
export function opsPerSecond(fn: () => void, n: number): number {
  for (let i = 0; i < 10_000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  return Math.round((n / (performance.now() - start)) * 1000);
}
