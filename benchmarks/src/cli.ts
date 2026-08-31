import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseResultsFile, checkRegressions } from './guardrail.ts';
import { assertNoSilentSkips } from './report.ts';
import type { BenchResult } from './results.ts';
import { runLiveBenchmarks } from './runner.ts';

export function runCli(args: string[] = process.argv.slice(2)): number {
  let baselinePath: string | undefined;
  let currentPath: string | undefined;
  let threshold = parseFloat(process.env.BENCHMARK_DROP_THRESHOLD ?? '0.20');

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--baseline' && i + 1 < args.length) {
      baselinePath = args[++i];
    } else if (arg === '--current' && i + 1 < args.length) {
      currentPath = args[++i];
    } else if (arg === '--threshold' && i + 1 < args.length) {
      i++;
      const val = args[i];
      if (val !== undefined) {
        threshold = parseFloat(val);
      }
    }
  }

  if (!baselinePath) {
    if (existsSync(resolve('benchmarks/baseline.json'))) {
      baselinePath = resolve('benchmarks/baseline.json');
    } else if (existsSync(resolve('benchmarks/RESULTS.md'))) {
      baselinePath = resolve('benchmarks/RESULTS.md');
    } else {
      console.error('[BENCHMARK GUARDRAIL] ERROR: No baseline file found or specified.');
      return 1;
    }
  } else {
    baselinePath = resolve(baselinePath);
  }

  if (!existsSync(baselinePath)) {
    console.error(`[BENCHMARK GUARDRAIL] ERROR: Baseline file does not exist: ${baselinePath}`);
    return 1;
  }

  console.log(`[BENCHMARK GUARDRAIL] Loading baseline from: ${baselinePath}`);
  let baselineResults: BenchResult[];
  try {
    baselineResults = parseResultsFile(baselinePath);
  } catch (err: unknown) {
    console.error(
      `[BENCHMARK GUARDRAIL] ERROR: Failed to parse baseline file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  let currentResults: BenchResult[];
  if (currentPath) {
    const resolvedCurrent = resolve(currentPath);
    if (!existsSync(resolvedCurrent)) {
      console.error(`[BENCHMARK GUARDRAIL] ERROR: Current results file does not exist: ${resolvedCurrent}`);
      return 1;
    }
    console.log(`[BENCHMARK GUARDRAIL] Loading current benchmark results from: ${resolvedCurrent}`);
    try {
      currentResults = parseResultsFile(resolvedCurrent);
    } catch (err: unknown) {
      console.error(
        `[BENCHMARK GUARDRAIL] ERROR: Failed to parse current results file: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  } else {
    console.log('[BENCHMARK GUARDRAIL] Executing live benchmarks to extract current metrics...');
    try {
      currentResults = runLiveBenchmarks();
    } catch (err: unknown) {
      console.error(
        `[BENCHMARK GUARDRAIL] ERROR: Failed executing live benchmarks: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  }

  // Enforce full suite reporting and honesty policy on current results
  try {
    assertNoSilentSkips(currentResults);
  } catch (err: unknown) {
    console.error(`[BENCHMARK GUARDRAIL] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const regressions = checkRegressions(baselineResults, currentResults, threshold);

  if (regressions.length > 0) {
    console.error(
      `\n[BENCHMARK GUARDRAIL] FAILED: ${regressions.length} performance regression(s) detected (threshold ${(threshold * 100).toFixed(0)}%):`,
    );
    for (const r of regressions) {
      console.error(`  ✖ [${r.kind.toUpperCase()}] ${r.suite}/${r.case} (${r.target}): ${r.detail}`);
    }
    return 1;
  }

  console.log(
    `[BENCHMARK GUARDRAIL] PASSED: All benchmark cases met baseline criteria (0 regressions detected, threshold ${(threshold * 100).toFixed(0)}%).`,
  );
  return 0;
}

// Entrypoint when executed directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = runCli();
  process.exit(exitCode);
}
