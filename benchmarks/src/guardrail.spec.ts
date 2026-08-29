import { describe, it, expect } from 'vitest';
import { checkRegressions, RegressionKind } from './guardrail.ts';
import type { BenchResult } from './results.ts';

// #73: regression-guardrail logic. Compares a previous vs current results set
// and flags ok→DNF transitions and ops/sec drops beyond a threshold.

const r = (patch: Partial<BenchResult>): BenchResult => ({
  suite: 'orm',
  case: 'customer-by-id',
  target: 'zmdb',
  status: 'ok',
  opsPerSec: 1000,
  ...patch,
});

describe('checkRegressions', () => {
  it('flags an ok → dnf transition', () => {
    const prev = [r({ status: 'ok', opsPerSec: 1000 })];
    const cur = [r({ status: 'dnf', opsPerSec: undefined, dnfReason: 'dnf (not implemented): x' })];
    const regs = checkRegressions(prev, cur, 0.2);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.kind).toBe(RegressionKind.OkToDnf);
  });

  it('flags an ops/sec drop beyond the threshold', () => {
    const prev = [r({ opsPerSec: 1000 })];
    const cur = [r({ opsPerSec: 700 })]; // 30% drop > 20% threshold
    const regs = checkRegressions(prev, cur, 0.2);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.kind).toBe(RegressionKind.ThroughputDrop);
  });

  it('does not flag a drop within the threshold', () => {
    const prev = [r({ opsPerSec: 1000 })];
    const cur = [r({ opsPerSec: 900 })]; // 10% drop <= 20% threshold
    expect(checkRegressions(prev, cur, 0.2)).toHaveLength(0);
  });

  it('does not flag improvements or dnf→ok', () => {
    const prev = [r({ status: 'dnf', opsPerSec: undefined, dnfReason: 'dnf (not implemented): x' })];
    const cur = [r({ status: 'ok', opsPerSec: 5000 })];
    expect(checkRegressions(prev, cur, 0.2)).toHaveLength(0);
  });

  it('ignores cases absent from the previous run (newly added)', () => {
    const prev: BenchResult[] = [];
    const cur = [r({ opsPerSec: 1000 })];
    expect(checkRegressions(prev, cur, 0.2)).toHaveLength(0);
  });
});
