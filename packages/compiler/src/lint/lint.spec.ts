import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

import { loadLintModule } from './__fixtures__/rule-tester.js';

const ruleNames = [
  'no-distributed-nullable-tags',
  'no-empty-patch',
  'no-interpolated-sql',
  'no-unbounded-find',
  'no-unknown-json-column',
  'require-sql-on-number',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function configuredRules(config: unknown): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  if (Array.isArray(config)) {
    for (const item of config) Object.assign(found, configuredRules(item));
    return found;
  }
  if (isRecord(config) && isRecord(config.rules)) Object.assign(found, config.rules);
  return found;
}

function byRuleName(config: unknown): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(configuredRules(config))) {
    const name = key.split('/').at(-1);
    if (name !== undefined) normalized[name] = value;
  }
  return normalized;
}

it('exports exactly the six frozen rules from the lint subpath', async () => {
  const module = await loadLintModule();
  expect(Object.keys(module.default.rules).toSorted()).toEqual(ruleNames);
});

it('sets the frozen recommended and strict severities', async () => {
  const module = await loadLintModule();
  expect(byRuleName(module.configs.recommended)).toEqual({
    'no-distributed-nullable-tags': 'error',
    'no-empty-patch': 'warn',
    'no-interpolated-sql': 'error',
    'no-unbounded-find': 'warn',
    'no-unknown-json-column': 'error',
    'require-sql-on-number': 'warn',
  });
  expect(byRuleName(module.configs.strict)).toEqual({
    'no-distributed-nullable-tags': 'error',
    'no-empty-patch': 'error',
    'no-interpolated-sql': 'error',
    'no-unbounded-find': 'error',
    'no-unknown-json-column': 'error',
    'require-sql-on-number': 'error',
  });
});

it('runs the complete recommended rule set through the repository lint command in CI', async () => {
  const module = await loadLintModule();
  const config = readFileSync(new URL('../../../../.oxlintrc.json', import.meta.url), 'utf8');
  const loader = readFileSync(new URL('../../../../scripts/zmdb-lint-plugin.mjs', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

  expect(config).toContain('"specifier": "./scripts/zmdb-lint-plugin.mjs"');
  for (const [name, severity] of Object.entries(byRuleName(module.configs.recommended))) {
    expect(config).toContain(`"zmdb/${name}": "${String(severity)}"`);
  }
  expect(loader).toContain("import './ts-specifier-hook.mjs'");
  expect(loader).toContain("await import('../packages/compiler/src/lint/index.js')");
  expect(manifest).toContain('"lint": "oxlint"');
  expect(workflow).toContain('name: Lint (oxlint + zmdb recommended rules)\n        run: yarn lint');
});
