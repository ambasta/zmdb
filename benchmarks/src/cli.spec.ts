import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { runCli } from './cli.ts';
import { fixtureResults } from './fixtures.ts';
import { competitorDnf } from './orm/adapter.ts';
import { toJson } from './report.ts';
import type { BenchResult } from './results.ts';

const testDir = join(__dirname, '..', '.test-tmp');

// The guardrail compares two result sets; what it needs is a complete, valid one,
// not a measured one. Fixed numbers also make the threshold arithmetic below
// exact instead of "50% of whatever this machine did".
const results = (): BenchResult[] => [...fixtureResults(), ...competitorDnf()];

describe('CLI Guardrail Script (runCli)', () => {
  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('passes when current results match baseline within threshold', () => {
    const base = results();
    const baselineFile = join(testDir, 'baseline-pass.json');
    const currentFile = join(testDir, 'current-pass.json');

    writeFileSync(baselineFile, toJson(base));
    writeFileSync(currentFile, toJson(base));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(0);
  });

  it('fails when a throughput drop exceeds the threshold', () => {
    const base = results();
    const baselineFile = join(testDir, 'baseline-drop.json');
    const currentFile = join(testDir, 'current-drop.json');

    writeFileSync(baselineFile, toJson(base));

    // Regress one case's opsPerSec by 50%
    const regressed: BenchResult[] = base.map(r => {
      if (r.suite === 'orm' && r.case === 'customer-by-id' && r.target === 'zmdb' && r.status === 'ok') {
        return { ...r, opsPerSec: Math.floor((r.opsPerSec ?? 1000) * 0.5) };
      }
      return r;
    });
    writeFileSync(currentFile, toJson(regressed));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(1);
  });

  it('fails when an ok case becomes dnf in current run', () => {
    const base = results();
    const baselineFile = join(testDir, 'baseline-dnf.json');
    const currentFile = join(testDir, 'current-dnf.json');

    writeFileSync(baselineFile, toJson(base));

    const regressed: BenchResult[] = base.map(r => {
      if (r.suite === 'orm' && r.case === 'customer-by-id' && r.target === 'zmdb') {
        return { ...r, status: 'dnf', opsPerSec: undefined, dnfReason: 'dnf (error): database connection failed' };
      }
      return r;
    });
    writeFileSync(currentFile, toJson(regressed));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(1);
  });

  it('fails when a baseline benchmark case is omitted from current results', () => {
    const base = results();
    const baselineFile = join(testDir, 'baseline-omitted.json');
    const currentFile = join(testDir, 'current-omitted.json');

    writeFileSync(baselineFile, toJson(base));

    // Omit a competitor DNF row (so assertNoSilentSkips on zmdb still passes, but checkRegressions flags missing baseline case)
    const omitted = base.filter(r => !(r.suite === 'orm' && r.case === 'customer-by-id' && r.target === 'drizzle'));
    writeFileSync(currentFile, JSON.stringify(omitted, null, 2));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(1);
  });

  it('fails when an in-scope primary target case is missing in current results (silent skip)', () => {
    const base = results();
    const baselineFile = join(testDir, 'baseline-skip.json');
    const currentFile = join(testDir, 'current-skip.json');

    writeFileSync(baselineFile, toJson(base));

    // Omit primary target zmdb case
    const skipped = base.filter(r => !(r.suite === 'validation' && r.case === 'safe-parse' && r.target === 'zmdb'));
    writeFileSync(currentFile, JSON.stringify(skipped, null, 2));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(1);
  });

  it('fails when baseline file does not exist', () => {
    const code = runCli(['--baseline', join(testDir, 'nonexistent.json')]);
    expect(code).toBe(1);
  });

  it('refuses to measure unless asked: no --current and no --live is an error', () => {
    const baselineFile = join(testDir, 'baseline-no-current.json');
    writeFileSync(baselineFile, toJson(results()));

    const code = runCli(['--baseline', baselineFile]);
    expect(code).toBe(1);
  });
});
