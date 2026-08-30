import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from './cli.ts';
import { runLiveBenchmarks } from './runner.ts';
import { toJson } from './report.ts';
import type { BenchResult } from './results.ts';

const testDir = join(__dirname, '..', '.test-tmp');

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
    const live = runLiveBenchmarks();
    const baselineFile = join(testDir, 'baseline-pass.json');
    const currentFile = join(testDir, 'current-pass.json');

    writeFileSync(baselineFile, toJson(live));
    writeFileSync(currentFile, toJson(live));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(0);
  });

  it('fails when a throughput drop exceeds the threshold', () => {
    const live = runLiveBenchmarks();
    const baselineFile = join(testDir, 'baseline-drop.json');
    const currentFile = join(testDir, 'current-drop.json');

    writeFileSync(baselineFile, toJson(live));

    // Regress one case's opsPerSec by 50%
    const regressed: BenchResult[] = live.map((r) => {
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
    const live = runLiveBenchmarks();
    const baselineFile = join(testDir, 'baseline-dnf.json');
    const currentFile = join(testDir, 'current-dnf.json');

    writeFileSync(baselineFile, toJson(live));

    const regressed: BenchResult[] = live.map((r) => {
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
    const live = runLiveBenchmarks();
    const baselineFile = join(testDir, 'baseline-omitted.json');
    const currentFile = join(testDir, 'current-omitted.json');

    writeFileSync(baselineFile, toJson(live));

    // Omit a competitor DNF row (so assertNoSilentSkips on zmdb still passes, but checkRegressions flags missing baseline case)
    const omitted = live.filter((r) => !(r.suite === 'orm' && r.case === 'customer-by-id' && r.target === 'drizzle'));
    writeFileSync(currentFile, JSON.stringify(omitted, null, 2));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(1);
  });

  it('fails when an in-scope primary target case is missing in current results (silent skip)', () => {
    const live = runLiveBenchmarks();
    const baselineFile = join(testDir, 'baseline-skip.json');
    const currentFile = join(testDir, 'current-skip.json');

    writeFileSync(baselineFile, toJson(live));

    // Omit primary target zmdb case
    const skipped = live.filter((r) => !(r.suite === 'validation' && r.case === 'safe-parse' && r.target === 'zmdb'));
    writeFileSync(currentFile, JSON.stringify(skipped, null, 2));

    const code = runCli(['--baseline', baselineFile, '--current', currentFile, '--threshold', '0.20']);
    expect(code).toBe(1);
  });

  it('fails when baseline file does not exist', () => {
    const code = runCli(['--baseline', join(testDir, 'nonexistent.json')]);
    expect(code).toBe(1);
  });
});
