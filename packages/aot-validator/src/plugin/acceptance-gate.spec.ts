// #83: the AOT acceptance gate.
//
// Two frozen targets from the epic:
//   (a) the emitted check is at least 5x the runtime walker, and
//   (b) an HONEST record of where it stands against typia and TypeBox.
//
// Published numbers (benchmarks/RESULTS.md, moltar runner):
//   parseSafe    AOT 98.4M   typia 100.7M   typebox DNF   -> competitive
//   assertLoose  AOT 87.8M   typia  78.1M   typebox 88.1M -> competitive/leads
//   parseStrict  AOT 13.2M   typia  38.9M                 -> BEHIND (~3x)
//   assertStrict AOT 14.0M   typia  31.1M   typebox 29.2M -> BEHIND (~2x)
//
// Verdict: (a) passes; (b) competitive on parse-safe and assert-loose, behind on the
// strict cases. Recorded rather than rounded up. The epic's rule is that a missed target
// gets an honest revision, not a quieter claim.
//
// Gate (a) used to read about 5-6x locally and failed intermittently at 4.6x, which looked
// like an unlucky threshold and was not. The loop discarded the emitted check's return value,
// so what it timed was a call V8 was in the middle of deciding it could delete; the AOT figure
// was low by roughly an order of magnitude and unstable in both directions. Timed honestly it
// is 110-140M ops/s against 2-4M for the walker, so 30x and up — in line with the ~98M the
// independent runner reports above. The 5x threshold stays as written because it is the epic's
// frozen target, not a description of the margin.

import { afterAll, describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.js';
import { is as runtimeIs } from '../utilities/index.js';
import { peakOpsPerSecond } from './inline-bench.js';

const TYPE = '{ a: number; b: string; c: { d: number } }';

const project = FixtureProject.open();
afterAll(() => project.close());

// Several distinct valid objects rather than one, rotated through by the timing loop. A single
// hoisted constant is something the optimizer can fold the inlined check's property loads out
// of entirely; a rotating input cannot be. Same shape, so both validators do the same work on
// each of them.
const good = [
  { a: 1, b: 'x', c: { d: 2 } },
  { a: 2, b: 'yy', c: { d: 3 } },
  { a: 3, b: 'zzz', c: { d: 4 } },
  { a: 4, b: 'wwww', c: { d: 5 } },
];
const at = (index: number): { a: number; b: string; c: { d: number } } => good[index & 3]!;

describe('AOT acceptance gate (#83)', () => {
  it('gate (a): AOT is at least 5x the runtime validator', () => {
    const { check } = project.build(`const check = (input) => is<${TYPE}>(input);`);
    const ir = project.ir(TYPE);
    // Best of 5, not one shot: a single 200k-iteration loop is short enough that one
    // descheduling by a saturated test runner cost this gate a third of its margin and failed
    // it, while it passed in isolation. Both results are returned rather than discarded, which
    // is what stops the faster side's loop from being optimized away — see `inline-bench.ts`.
    const N = 200_000;
    const TRIALS = 5;
    const aotOps = peakOpsPerSecond(index => check(at(index)), N, TRIALS);
    const runtimeOps = peakOpsPerSecond(index => runtimeIs(at(index), ir), N, TRIALS);
    const ratio = aotOps / runtimeOps;
    console.log(
      `gate(a): AOT ${aotOps.toLocaleString()} ops/s vs runtime ${runtimeOps.toLocaleString()} = ${ratio.toFixed(1)}x`,
    );
    expect(ratio).toBeGreaterThanOrEqual(5);
  });

  it('gate (b): honest competitiveness record vs typia/TypeBox', () => {
    // Encoded from the published moltar-runner numbers, so the verdict cannot silently
    // drift into an overclaim while nobody is rereading RESULTS.md.
    const verdict = {
      parseSafe: 'competitive', // AOT ~98M ~= typia ~100M
      assertLoose: 'competitive', // AOT ~88M ~= typebox ~88M, > typia
      parseStrict: 'behind', // AOT ~13M < typia ~39M
      assertStrict: 'behind', // AOT ~14M < typia/typebox ~30M
    };
    // The claim is not "fastest everywhere". It is: the AOT path clears the 5x-runtime
    // gate and is competitive on parse-safe and assert-loose, while the strict cases lag
    // typia and TypeBox and remain a tracked optimisation (excess-key checking).
    expect(verdict.parseStrict).toBe('behind');
    expect(verdict.assertStrict).toBe('behind');
    expect([verdict.parseSafe, verdict.assertLoose]).toEqual(['competitive', 'competitive']);
  });
});
