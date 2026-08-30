// #73 — regression guardrail. Compares a previous vs current benchmark result
// set and flags meaningful regressions the CI job should fail on:
//   • ok → dnf   (a previously-working case stopped working)
//   • throughput drop beyond an agreed fractional threshold
// Improvements, dnf→ok, and newly-added cases are never flagged.
import type { BenchResult } from './results.ts';

export enum RegressionKind {
  OkToDnf = 'ok_to_dnf',
  ThroughputDrop = 'throughput_drop',
}

export interface Regression {
  readonly kind: RegressionKind;
  readonly suite: string;
  readonly case: string;
  readonly target: string;
  readonly detail: string;
}

function key(r: BenchResult): string {
  return `${r.suite}\u0000${r.case}\u0000${r.target}`;
}

export function checkRegressions(
  previous: readonly BenchResult[],
  current: readonly BenchResult[],
  dropThreshold: number,
): Regression[] {
  const prev = new Map(previous.map(r => [key(r), r]));
  const regressions: Regression[] = [];

  for (const cur of current) {
    const before = prev.get(key(cur));
    if (!before) continue; // newly added — nothing to regress against

    if (before.status === 'ok' && cur.status === 'dnf') {
      regressions.push({
        kind: RegressionKind.OkToDnf,
        suite: cur.suite,
        case: cur.case,
        target: cur.target,
        detail: `was ok (${before.opsPerSec} ops/s), now ${cur.dnfReason ?? 'dnf'}`,
      });
      continue;
    }

    if (
      before.status === 'ok' &&
      cur.status === 'ok' &&
      typeof before.opsPerSec === 'number' &&
      typeof cur.opsPerSec === 'number' &&
      before.opsPerSec > 0
    ) {
      const drop = (before.opsPerSec - cur.opsPerSec) / before.opsPerSec;
      if (drop > dropThreshold) {
        regressions.push({
          kind: RegressionKind.ThroughputDrop,
          suite: cur.suite,
          case: cur.case,
          target: cur.target,
          detail: `throughput dropped ${(drop * 100).toFixed(1)}% (${before.opsPerSec} → ${cur.opsPerSec} ops/s), threshold ${(dropThreshold * 100).toFixed(0)}%`,
        });
      }
    }
  }
  return regressions;
}
