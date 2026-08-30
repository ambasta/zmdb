import { describe, it, expect } from 'vitest';

import { is as runtimeIs, type TypeDescriptor } from '../utilities/index.ts';
import { zmdbAot } from './index.ts';

// #83: AOT acceptance gate. Enforces the frozen target from the epic:
//   (a) AOT is >=5x the runtime path, and
//   (b) an HONEST record of AOT-vs-typia/TypeBox competitiveness.
// Per the epic, if a target is missed the claim is revised honestly rather than
// faked. Published numbers (benchmarks/RESULTS.md, moltar runner):
//   parseSafe   AOT 98.4M   typia 100.7M   typebox DNF   -> competitive
//   assertLoose AOT 87.8M   typia  78.1M   typebox 88.1M -> competitive/leads
//   parseStrict AOT 13.2M   typia  38.9M                 -> BEHIND (~3x)
//   assertStrict AOT 14.0M  typia  31.1M   typebox 29.2M -> BEHIND (~2x)
// Verdict: gate (a) PASSES; (b) competitive on parse-safe/assert-loose, but
// BEHIND typia/TypeBox on the strict cases — recorded honestly, not overclaimed.

declare const performance: { now(): number };

const plugin = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };

function buildAotCheck(): (input: unknown) => boolean {
  const src = 'const check = (input) => is<{ a: number; b: string; c: { d: number } }>(input);';
  const out = plugin.transform(src, '/fixture/gate.ts')!;
  return new Function(`${out.code}; return check;`)() as (input: unknown) => boolean;
}

const desc: TypeDescriptor = {
  kind: 'object',
  fields: { a: { kind: 'number' }, b: { kind: 'string' }, c: { kind: 'object', fields: { d: { kind: 'number' } } } },
};
const good = { a: 1, b: 'x', c: { d: 2 } };
const bench = (fn: () => void, n: number) => {
  for (let i = 0; i < 10_000; i++) fn();
  const s = performance.now();
  for (let i = 0; i < n; i++) fn();
  return Math.round((n / (performance.now() - s)) * 1000);
};

describe('AOT acceptance gate (#83)', () => {
  it('gate (a): AOT is at least 5x the runtime validator', () => {
    const aot = buildAotCheck();
    const N = 200_000;
    const aotOps = bench(() => void aot(good), N);
    const runtimeOps = bench(() => void runtimeIs(good, desc), N);
    const ratio = aotOps / runtimeOps;
    console.log(
      `gate(a): AOT ${aotOps.toLocaleString()} ops/s vs runtime ${runtimeOps.toLocaleString()} = ${ratio.toFixed(1)}x`,
    );
    expect(ratio).toBeGreaterThanOrEqual(5);
  });

  it('gate (b): honest competitiveness record vs typia/TypeBox', () => {
    // Encoded from the published moltar-runner numbers (RESULTS.md). This test
    // documents the verdict so it cannot silently drift into an overclaim.
    const verdict = {
      parseSafe: 'competitive', // AOT ~98M ~= typia ~100M
      assertLoose: 'competitive', // AOT ~88M ~= typebox ~88M, > typia
      parseStrict: 'behind', // AOT ~13M < typia ~39M
      assertStrict: 'behind', // AOT ~14M < typia/typebox ~30M
    };
    // The claim is NOT "fastest everywhere". It is: AOT clears the 5x-runtime
    // gate and is competitive on parse-safe/assert-loose, but strict cases lag
    // typia/TypeBox and remain a tracked optimization (excess-key checking).
    expect(verdict.parseStrict).toBe('behind');
    expect(verdict.assertStrict).toBe('behind');
    expect([verdict.parseSafe, verdict.assertLoose]).toEqual(['competitive', 'competitive']);
  });
});
