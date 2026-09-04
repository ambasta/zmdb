import { readFileSync } from 'node:fs';

import { RuleTester } from 'oxlint/plugins-dev';

import lintPlugin, { configs } from '../index.js';

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

const lintModule: unknown = { default: lintPlugin, configs };

export async function loadLintModule(): Promise<LintModule> {
  if (!isLintModule(lintModule)) throw new Error('@zmdb/aot-validator/lint has an invalid plugin shape');
  return lintModule;
}

/**
 * Run exactly one outer Vitest case through oxlint's own RuleTester. The two
 * host callbacks are made immediate only for the duration of the outer test;
 * parsing, traversal, diagnostics, fix passes and suggestions remain
 * RuleTester's.
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
