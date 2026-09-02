// #70 — validation-suite adapter + runner.
// Maps the moltar case model onto zmdb's aot-validator entry points and runs
// a tiny in-process benchmark producing BenchResult[] (with any DNF).
//
// The witness is a `TypeIR`, which is what a generated one is: this file used to take a
// `TypeDescriptor`, and every caller therefore had to hand-write the shape it was already
// declaring in TypeScript (REQ-TF-9).
import { equals, is, validate, type TypeIR } from '@zmdb/aot-validator/utilities';

import type { BenchResult } from '../results.ts';

// Minimal high-resolution clock (Node 26 provides globalThis.performance;
// declared locally to avoid a hard @types/node dependency in the harness).
declare const performance: { now(): number };

// The four moltar cases, mapped to zmdb behavior.
export interface ValidationAdapter {
  // safe-parse: validate + strip excess → returns validated data or null.
  safeParse(input: unknown, type: TypeIR): unknown | null;
  // strict-parse: validate + reject excess → returns data or null.
  strictParse(input: unknown, type: TypeIR): unknown | null;
  // loose-assert: assert, allow excess → boolean.
  looseAssert(input: unknown, type: TypeIR): boolean;
  // strict-assert: assert, reject excess → boolean.
  strictAssert(input: unknown, type: TypeIR): boolean;
}

export const zmdbAdapter: ValidationAdapter = {
  safeParse(input, type) {
    const r = validate(input, type);
    return r.success ? r.data : null;
  },
  strictParse(input, type) {
    return equals(input, type) ? input : null;
  },
  looseAssert(input, type) {
    return is(input, type);
  },
  // `equals`, not `is` plus a local excess-key check: the strict case is a shipped
  // entry point now, and an adapter that reimplements it is benchmarking the adapter.
  strictAssert(input, type) {
    return equals(input, type);
  },
};

const CASE_IDS = ['safe-parse', 'strict-parse', 'loose-assert', 'strict-assert'] as const;

// Run the four cases for a given target adapter against a sample workload.
// Returns a BenchResult per case (all `ok` for zmdb — no DNF in this suite).
export function runValidationSuite(
  target: string,
  adapter: ValidationAdapter,
  type: TypeIR,
  goodInput: unknown,
  iterations = 1000,
): BenchResult[] {
  const runners: Record<(typeof CASE_IDS)[number], () => void> = {
    'safe-parse': () => void adapter.safeParse(goodInput, type),
    'strict-parse': () => void adapter.strictParse(goodInput, type),
    'loose-assert': () => void adapter.looseAssert(goodInput, type),
    'strict-assert': () => void adapter.strictAssert(goodInput, type),
  };
  const results: BenchResult[] = [];
  for (const id of CASE_IDS) {
    const fn = runners[id];
    const warmup = Math.min(iterations, 200);
    for (let i = 0; i < warmup; i++) fn();

    const samples = 5;
    let maxOps = 0;
    for (let s = 0; s < samples; s++) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) fn();
      const elapsedMs = performance.now() - start;
      const opsPerSec = elapsedMs > 0 ? Math.round((iterations / elapsedMs) * 1000) : iterations;
      if (opsPerSec > maxOps) maxOps = opsPerSec;
    }
    results.push({ suite: 'validation', case: id, target, status: 'ok', opsPerSec: maxOps });
  }
  return results;
}
