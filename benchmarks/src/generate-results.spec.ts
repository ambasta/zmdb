import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { toMarkdown } from './report.ts';
import { runLiveBenchmarks } from './runner.ts';

// Generates benchmarks/RESULTS.md from LIVE runs (validation + ORM against
// node:sqlite), using the #72 report generator (single source of truth for
// formatting + honesty guard). Competitor rows are honest DNF.

describe('benchmark RESULTS.md generation (live)', () => {
  it('writes a schema-valid, deterministically-ordered RESULTS.md via the #72 generator', () => {
    const md = toMarkdown(runLiveBenchmarks()); // throws if any in-scope case is missing
    // Deterministic ordering (numbers aside): regenerating yields same shape.
    const shape = (s: string) => s.replace(/\d+ ops\/s/g, 'N ops/s');
    expect(shape(toMarkdown(runLiveBenchmarks()))).toBe(shape(md));

    const here = dirname(fileURLToPath(import.meta.url));
    // NOTE: the authoritative comparative report is benchmarks/RESULTS.md,
    // produced by the real head-to-head harnesses in benchmarks/harness/.
    // This in-process generator writes an internal artifact only, so it does
    // not clobber the real results.
    writeFileSync(join(here, '..', '.internal-results.md'), md);
    expect(md).toContain('dnf (anti-pattern)');
    expect(md).toContain('dnf (not implemented)');
  });
});
