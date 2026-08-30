import { describe, it, expect } from 'vitest';

import { checkRegressions, RegressionKind, parseJsonResults, parseMarkdownResults } from './guardrail.ts';
import type { BenchResult } from './results.ts';

// #73: regression-guardrail logic. Compares a previous vs current results set
// and flags ok→DNF transitions, ops/sec drops beyond a threshold, and missing cases.

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

  it('flags cases present in baseline but omitted from current run', () => {
    const prev = [r({ case: 'customer-by-id', opsPerSec: 1000 }), r({ case: 'products-search', opsPerSec: 2000 })];
    const cur = [r({ case: 'customer-by-id', opsPerSec: 1000 })];
    const regs = checkRegressions(prev, cur, 0.2);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.kind).toBe(RegressionKind.MissingCase);
    expect(regs[0]!.case).toBe('products-search');
  });
});

describe('baseline result parsers', () => {
  it('parses JSON benchmark results', () => {
    const json = JSON.stringify([r({ suite: 'orm', case: 'customer-by-id', opsPerSec: 1500 })]);
    const res = parseJsonResults(json);
    expect(res).toHaveLength(1);
    expect(res[0]!.opsPerSec).toBe(1500);
  });

  it('parses Markdown benchmark results tables', () => {
    const md = `
| Suite | Case | Target | Result |
|-------|------|--------|--------|
| orm | customer-by-id | zmdb | 58690 ops/s |
| orm | active-record-save | zmdb | dnf (anti-pattern): rejected |
`;
    const res = parseMarkdownResults(md);
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({
      suite: 'orm',
      case: 'customer-by-id',
      target: 'zmdb',
      status: 'ok',
      opsPerSec: 58690,
    });
    expect(res[1]).toEqual({
      suite: 'orm',
      case: 'active-record-save',
      target: 'zmdb',
      status: 'dnf',
      dnfReason: 'dnf (anti-pattern): rejected',
    });
  });
});
