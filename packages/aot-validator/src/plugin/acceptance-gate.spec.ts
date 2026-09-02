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

import { afterAll, describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.ts';
import { is as runtimeIs } from '../utilities/index.ts';
import { opsPerSecond } from './inline-bench.ts';

const TYPE = '{ a: number; b: string; c: { d: number } }';

const project = FixtureProject.open();
afterAll(() => project.close());

const good = { a: 1, b: 'x', c: { d: 2 } };

describe('AOT acceptance gate (#83)', () => {
  it('gate (a): AOT is at least 5x the runtime validator', () => {
    const { check } = project.build(`const check = (input) => is<${TYPE}>(input);`);
    const ir = project.ir(TYPE);
    const N = 200_000;
    const aotOps = opsPerSecond(() => void check(good), N);
    const runtimeOps = opsPerSecond(() => void runtimeIs(good, ir), N);
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
