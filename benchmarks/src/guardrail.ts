// #73 — regression guardrail. Compares a previous vs current benchmark result
// set and flags meaningful regressions the CI job should fail on:
//   • ok → dnf   (a previously-working case stopped working)
//   • throughput drop beyond an agreed fractional threshold
//   • missing/omitted benchmark cases
// Improvements, dnf→ok, and newly-added cases are never flagged.
import { readFileSync, existsSync } from 'node:fs';

import type { BenchResult } from './results.js';

export const RegressionKind = {
  OkToDnf: 'ok_to_dnf',
  ThroughputDrop: 'throughput_drop',
  MissingCase: 'missing_case',
} as const;

export type RegressionKind = (typeof RegressionKind)[keyof typeof RegressionKind];

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
  const curMap = new Map(current.map(r => [key(r), r]));
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

  // Check for baseline cases missing/omitted in current results
  for (const before of previous) {
    if (!curMap.has(key(before))) {
      regressions.push({
        kind: RegressionKind.MissingCase,
        suite: before.suite,
        case: before.case,
        target: before.target,
        detail: `case was present in baseline (${before.opsPerSec !== undefined ? `${before.opsPerSec} ops/s` : before.status}), but omitted in current run`,
      });
    }
  }

  return regressions;
}

export function parseJsonResults(content: string): BenchResult[] {
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid JSON benchmark format: expected array');
  }
  const results: BenchResult[] = [];
  for (const item of parsed) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'suite' in item &&
      'case' in item &&
      'target' in item &&
      'status' in item &&
      (item.suite === 'validation' || item.suite === 'orm') &&
      typeof item.case === 'string' &&
      typeof item.target === 'string' &&
      (item.status === 'ok' || item.status === 'dnf')
    ) {
      results.push({
        suite: item.suite,
        case: item.case,
        target: item.target,
        status: item.status,
        opsPerSec: typeof item.opsPerSec === 'number' ? item.opsPerSec : undefined,
        dnfReason: typeof item.dnfReason === 'string' ? item.dnfReason : undefined,
      });
    }
  }
  return results;
}

export function parseMarkdownResults(content: string): BenchResult[] {
  const results: BenchResult[] = [];
  const lines = content.split(/\r?\n/);

  let inTable = false;
  let headers: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      inTable = false;
      headers = [];
      continue;
    }

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map(c => c.trim());

    if (cells.every(c => /^:?-+:?$/.test(c))) {
      // separator row
      inTable = true;
      continue;
    }

    if (!inTable) {
      headers = cells.map(c => c.toLowerCase());
      inTable = true;
      continue;
    }

    // Standard 4-column report.ts format: Suite | Case | Target | Result
    if (headers.includes('suite') && headers.includes('case') && headers.includes('target')) {
      const suiteIdx = headers.indexOf('suite');
      const caseIdx = headers.indexOf('case');
      const targetIdx = headers.indexOf('target');
      const resultIdx = headers.findIndex(h => h === 'result' || h.includes('ops') || h.includes('status'));

      if (suiteIdx !== -1 && caseIdx !== -1 && targetIdx !== -1 && resultIdx !== -1) {
        const suite = cells[suiteIdx]?.toLowerCase();
        const caseName = cells[caseIdx];
        const target = cells[targetIdx];
        const resText = cells[resultIdx] ?? '';

        if ((suite === 'validation' || suite === 'orm') && caseName && target) {
          if (resText.toLowerCase().includes('dnf')) {
            results.push({
              suite,
              case: caseName,
              target,
              status: 'dnf',
              dnfReason: resText,
            });
          } else {
            const match = resText.replace(/,/g, '').match(/[\d.]+/);
            const valStr = match?.[0];
            if (valStr) {
              results.push({
                suite,
                case: caseName,
                target,
                status: 'ok',
                opsPerSec: parseFloat(valStr),
              });
            }
          }
        }
      }
    } else if (headers.includes('library') || headers[0] === 'library') {
      // Validation matrix table (library | parseSafe | parseStrict | ...)
      const libRaw = cells[0] || '';
      let target = libRaw.replace(/[*_]/g, '').trim();
      if (target.includes('(')) {
        const parts = target.split('(');
        const prefix = parts[0];
        if (prefix) {
          target = prefix.trim();
        }
      }

      const caseMap: Record<string, string> = {
        parsesafe: 'safe-parse',
        parsestrict: 'strict-parse',
        assertloose: 'loose-assert',
        assertstrict: 'strict-assert',
      };

      for (let i = 1; i < cells.length; i++) {
        const colHeader = headers[i]?.toLowerCase();
        if (colHeader) {
          const caseName = caseMap[colHeader];
          if (caseName) {
            const cellVal = cells[i] || '';
            if (cellVal.toLowerCase().includes('dnf') || cellVal === '—') {
              results.push({
                suite: 'validation',
                case: caseName,
                target,
                status: 'dnf',
                dnfReason: cellVal,
              });
            } else {
              const match = cellVal.replace(/,/g, '').match(/[\d.]+/);
              const valStr = match?.[0];
              if (valStr) {
                results.push({
                  suite: 'validation',
                  case: caseName,
                  target,
                  status: 'ok',
                  opsPerSec: parseFloat(valStr),
                });
              }
            }
          }
        }
      }
    }
  }

  return results;
}

export function parseResultsFile(filePathOrContent: string): BenchResult[] {
  let content = filePathOrContent;
  if (existsSync(filePathOrContent)) {
    content = readFileSync(filePathOrContent, 'utf-8');
  }

  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    return parseJsonResults(trimmed);
  } else {
    return parseMarkdownResults(trimmed);
  }
}
