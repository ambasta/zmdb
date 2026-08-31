// #70 — validation-suite adapter + runner.
// Maps the moltar case model onto zmdb's aot-validator entry points and runs
// a tiny in-process benchmark producing BenchResult[] (with any DNF).
import { is, validate, type TypeDescriptor } from '@zmdb/aot-validator/utilities';

import type { BenchResult } from '../results.ts';

// Minimal high-resolution clock (Node 26 provides globalThis.performance;
// declared locally to avoid a hard @types/node dependency in the harness).
declare const performance: { now(): number };

// Strict membership: is<T> plus a top-level excess-key check. (We implement the
// excess-key guard here rather than depend on equals<T>, which is a separate
// unblocked-later concern; strict parsing itself is in-scope, not a DNF.)
function noExcessKeys(input: unknown, d: TypeDescriptor): boolean {
  if (d.kind !== 'object' || typeof input !== 'object' || input === null) return true;
  const allowed = new Set(Object.keys(d.fields ?? {}));
  return Object.keys(input).every(k => allowed.has(k));
}

// The four moltar cases, mapped to zmdb behavior.
export interface ValidationAdapter {
  // safe-parse: validate + strip excess → returns validated data or null.
  safeParse(input: unknown, d: TypeDescriptor): unknown | null;
  // strict-parse: validate + reject excess → returns data or null.
  strictParse(input: unknown, d: TypeDescriptor): unknown | null;
  // loose-assert: assert, allow excess → boolean.
  looseAssert(input: unknown, d: TypeDescriptor): boolean;
  // strict-assert: assert, reject excess → boolean.
  strictAssert(input: unknown, d: TypeDescriptor): boolean;
}

export const zmdbAdapter: ValidationAdapter = {
  safeParse(input, d) {
    const r = validate(input, d);
    return r.success ? r.data : null;
  },
  strictParse(input, d) {
    return is(input, d) && noExcessKeys(input, d) ? input : null;
  },
  looseAssert(input, d) {
    return is(input, d);
  },
  strictAssert(input, d) {
    return is(input, d) && noExcessKeys(input, d);
  },
};

const CASE_IDS = ['safe-parse', 'strict-parse', 'loose-assert', 'strict-assert'] as const;

// Run the four cases for a given target adapter against a sample workload.
// Returns a BenchResult per case (all `ok` for zmdb — no DNF in this suite).
export function runValidationSuite(
  target: string,
  adapter: ValidationAdapter,
  descriptor: TypeDescriptor,
  goodInput: unknown,
  iterations = 1000,
): BenchResult[] {
  const runners: Record<(typeof CASE_IDS)[number], () => void> = {
    'safe-parse': () => void adapter.safeParse(goodInput, descriptor),
    'strict-parse': () => void adapter.strictParse(goodInput, descriptor),
    'loose-assert': () => void adapter.looseAssert(goodInput, descriptor),
    'strict-assert': () => void adapter.strictAssert(goodInput, descriptor),
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
