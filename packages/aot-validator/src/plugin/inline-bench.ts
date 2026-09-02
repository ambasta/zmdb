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
//
// A note on why the loops below look the way they do, since it is the whole reason these
// numbers mean anything. The measured function must be called for its *result*, and that
// result has to reach something observable. An earlier version timed `() => void check(input)`
// and discarded the boolean: for the inlined AOT check — a pure function of a hoisted constant
// — V8 eventually proves the call has no effect and deletes the loop body. That does not read
// as an error, it reads as 1.4 *billion* ops/sec, about 90x the honest figure, and it only
// appears once the function is fully optimized. So the fixed 200k-iteration single shot was
// getting a roughly truthful number by not running long enough to be optimized properly, and
// any attempt to measure it more carefully made it worse.
//
// Hence: `fn` returns a value, every return value is folded into a counter, and the counter is
// read afterwards. The input is also rotated, so the checked object is not a constant the
// optimizer can fold the property loads out of.

declare const performance: { now(): number };

/**
 * Ops/sec for `fn` over `n` iterations, after a 10k-iteration warm-up.
 *
 * `fn` receives a rotating index and must return something derived from the work it did. Both
 * halves matter — see the file header.
 */
export function opsPerSecond(fn: (index: number) => unknown, n: number): number {
  let sink = 0;
  for (let i = 0; i < 10_000; i++) if (fn(i)) sink++;
  const start = performance.now();
  for (let i = 0; i < n; i++) if (fn(i)) sink++;
  const elapsed = performance.now() - start;
  // Reading `sink` is what keeps the calls that produced it alive. Without a use, the whole
  // loop is dead code and a sufficiently good optimizer is entitled to say so.
  if (sink < 0) throw new Error('unreachable, and here to make the measured work observable');
  return Math.round((n / elapsed) * 1000);
}

/**
 * The best of `trials` runs of `opsPerSecond(fn, n)`.
 *
 * For a *ratio* between two functions, one measurement each is not enough. A single timed loop
 * here is tens of milliseconds long, and when vitest is running the whole suite across every
 * core, one descheduling of that length is the difference between a 6x reading and a 4.6x one
 * — which is exactly how the acceptance gate came to fail under load and pass in isolation.
 *
 * Best-of rather than a mean, because contention is one-sided: it can only ever make a
 * function look slower than it is, never faster. The fastest of several runs is the closest
 * available estimate of what the code itself does, which is what the gate is a claim about.
 */
export function peakOpsPerSecond(fn: (index: number) => unknown, n: number, trials: number): number {
  let best = 0;
  for (let trial = 0; trial < trials; trial++) best = Math.max(best, opsPerSecond(fn, n));
  return best;
}
