import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { fixtureResults } from './fixtures.ts';
import { parseResultsFile } from './guardrail.ts';
import { toMarkdown, assertNoSilentSkips } from './report.ts';

// #72: the RESULTS.md pipeline, checked without measuring anything.
//
// This used to call runLiveBenchmarks() twice and normalise the ops/sec out of
// both renders — so it paid for two live suites to assert something about
// formatting. The two properties worth holding are separable: the generator is
// deterministic given rows (fixtures), and the committed RESULTS.md is complete
// (read it). Measurement stays in `yarn bench`, run locally.

const RESULTS_MD = join(dirname(fileURLToPath(import.meta.url)), '..', 'RESULTS.md');

describe('RESULTS.md generation', () => {
  it('renders deterministically and shows both DNF kinds', () => {
    const rows = [
      ...fixtureResults(),
      {
        suite: 'orm' as const,
        case: 'customer-by-id',
        target: 'drizzle',
        status: 'dnf' as const,
        dnfReason: 'dnf (not implemented): competitor harness not wired here',
      },
    ];
    const md = toMarkdown(rows);
    expect(toMarkdown(rows)).toBe(md);
    expect(md).toContain('dnf (anti-pattern)');
    expect(md).toContain('dnf (not implemented)');
  });
});

describe('the committed RESULTS.md', () => {
  it('parses and covers every in-scope case', () => {
    const rows = parseResultsFile(RESULTS_MD);
    expect(rows.length).toBeGreaterThan(0);
    // Same guard the generator applies on write: an in-scope case missing from
    // the committed file is an error, not a silent skip.
    expect(() => assertNoSilentSkips(rows)).not.toThrow();
  });
});
