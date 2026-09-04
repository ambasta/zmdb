// #72 — DNF reporting + comparative results table generator.
// Aggregates BenchResult[] into deterministic Markdown + JSON. DNF is rendered
// explicitly (never omitted); an in-scope case missing from the inputs is a
// hard ERROR, not a silent skip.
import { IN_SCOPE_CASES, validateResult, type BenchResult } from './results.js';

export class ReportError extends Error {}

function sortKey(r: BenchResult): string {
  return `${r.suite}\u0000${r.case}\u0000${r.target}`;
}

// Enforce the honesty policy: the PRIMARY target (our project) must cover EVERY
// in-scope case for each suite it reports (as ok or dnf). External competitor
// targets are only compared on the cases we actually run them on, so they are
// not required to cover the full matrix — but every emitted result (any target)
// must still be schema-valid.
export function assertNoSilentSkips(results: readonly BenchResult[], primaryTarget = 'zmdb'): void {
  const primaryCases = new Map<string, Set<string>>(); // suite -> cases (primary only)
  for (const r of results) {
    const schemaErrors = validateResult(r);
    const firstErr = schemaErrors[0];
    if (firstErr) {
      throw new ReportError(`invalid result for ${r.suite}/${r.case}/${r.target}: ${firstErr.message}`);
    }
    if (r.target === primaryTarget) {
      const set = primaryCases.get(r.suite) ?? new Set<string>();
      set.add(r.case);
      primaryCases.set(r.suite, set);
    }
  }
  for (const suite of ['validation', 'orm'] as const) {
    const covered = primaryCases.get(suite);
    if (!covered) continue; // primary didn't report this suite at all
    for (const c of IN_SCOPE_CASES[suite]) {
      if (!covered.has(c)) {
        throw new ReportError(
          `in-scope case "${c}" missing for ${suite}/${primaryTarget} (must be ok or dnf, never silently skipped)`,
        );
      }
    }
  }
}

export function toJson(results: readonly BenchResult[]): string {
  assertNoSilentSkips(results);
  const sorted = [...results].toSorted((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return JSON.stringify(sorted, null, 2);
}

export function toMarkdown(results: readonly BenchResult[]): string {
  assertNoSilentSkips(results);
  const sorted = [...results].toSorted((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const row = (r: BenchResult) =>
    `| ${r.suite} | ${r.case} | ${r.target} | ${r.status === 'ok' ? `${r.opsPerSec} ops/s` : r.dnfReason} |`;
  return [
    '# Benchmark Results',
    '',
    '> Validation + ORM suites. DNF rows are shown explicitly (never omitted):',
    '> `dnf (anti-pattern)` for rejected patterns, `dnf (not implemented)` for',
    '> supported-in-principle cases not yet wired. Numbers are indicative of the',
    '> generating machine, not an official ranking.',
    '',
    '| Suite | Case | Target | Result |',
    '|-------|------|--------|--------|',
    ...sorted.map(row),
    '',
  ].join('\n');
}
