// The transform-then-run harness the AOT plugin benchmarks share.
//
// Both #82 (the build produces a working inlined validator) and #83 (the
// acceptance gate) do the same three things: push a fixture module through the
// plugin's transform hook, evaluate the result to get a callable validator, and
// time it against the runtime walker. Each had its own copy of the evaluation
// and the timing loop, so a change to how "ops/sec" is measured would have had
// to be made twice for the two numbers to stay comparable.
import { zmdbAot } from './index.ts';

declare const performance: { now(): number };

type TransformHook = (code: string, id: string) => { code: string } | null;

/** The plugin's transform hook, at the shape a caller can invoke directly. */
export function transform(code: string, id: string): { code: string } | null {
  return (zmdbAot() as { transform: TransformHook }).transform(code, id);
}

export interface InlinedCheck {
  /** The emitted source, for asserting the runtime call really is gone. */
  readonly code: string;
  readonly check: (input: unknown) => boolean;
}

/**
 * Transform `src` and evaluate it, returning the `check` it declares. `src` must
 * assign the validator to a `const check`, since that is what gets returned.
 */
export function buildInlinedCheck(src: string, id: string): InlinedCheck {
  const out = transform(src, id);
  if (!out) throw new Error(`transform produced no output for ${id}`);
  return { code: out.code, check: new Function(`${out.code}; return check;`)() as (input: unknown) => boolean };
}

/** Ops/sec for `fn` over `n` iterations, after a 10k-iteration warm-up. */
export function opsPerSecond(fn: () => void, n: number): number {
  for (let i = 0; i < 10_000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  return Math.round((n / (performance.now() - start)) * 1000);
}
