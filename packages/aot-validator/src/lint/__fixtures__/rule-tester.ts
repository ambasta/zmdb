import { readFileSync } from 'node:fs';

import { RuleTester } from 'oxlint/plugins-dev';

export type HostRule = Parameters<RuleTester['run']>[1];

export interface LintPlugin {
  readonly meta: {
    readonly name: string;
    readonly version: string;
  };
  readonly rules: Readonly<Record<string, HostRule>>;
}

export interface LintModule {
  readonly default: LintPlugin;
  readonly configs: {
    readonly recommended: unknown;
    readonly strict: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHostRule(value: unknown): value is HostRule {
  return isRecord(value) && typeof value.create === 'function';
}

function isLintModule(value: unknown): value is LintModule {
  if (!isRecord(value) || !isRecord(value.default) || !isRecord(value.default.meta)) return false;
  if (typeof value.default.meta.name !== 'string' || typeof value.default.meta.version !== 'string') return false;
  if (!isRecord(value.default.rules) || !Object.values(value.default.rules).every(isHostRule)) return false;
  return isRecord(value.configs) && 'recommended' in value.configs && 'strict' in value.configs;
}

/**
 * Load the real future lint entry inside an `it.fails` body.
 *
 * A static import would fail while Vitest collects this tests-freeze and would
 * never become an expected failure. The computed specifier keeps the missing
 * module failure inside the test. #486 can make this a static import when it
 * retires the expected failures.
 */
export async function loadLintModule(): Promise<LintModule> {
  const specifier = ['..', 'index.js'].join('/');
  const loaded: unknown = await import(specifier);
  if (!isLintModule(loaded)) {
    throw new Error('@zmdb/aot-validator/lint must default-export { meta, rules } and export configs');
  }
  return loaded;
}

/**
 * Run exactly one outer Vitest case through oxlint's own RuleTester.
 *
 * RuleTester normally registers its own tests at module evaluation time. That
 * cannot load a module which intentionally does not exist yet, so the two host
 * callbacks are made immediate only for the duration of this `it.fails` body.
 * The parser, traversal, diagnostics, fix passes and suggestion assertions are
 * still RuleTester's.
 */
export async function runRuleCase(ruleName: string, tests: RuleTester.TestCases): Promise<void> {
  const module = await loadLintModule();
  const rule = module.default.rules[ruleName];
  if (rule === undefined) throw new Error(`@zmdb/aot-validator/lint does not export rule "${ruleName}"`);

  const previousDescribe = RuleTester.describe;
  const previousIt = RuleTester.it;
  try {
    RuleTester.describe = (_title, body) => body();
    RuleTester.it = (_title, body) => body();
    new RuleTester({
      eslintCompat: true,
      languageOptions: {
        parserOptions: { lang: 'ts' },
        sourceType: 'module',
      },
    }).run(ruleName, rule, tests);
  } finally {
    RuleTester.describe = previousDescribe;
    RuleTester.it = previousIt;
  }
}

export function fixture(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}
