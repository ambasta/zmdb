// Set consistent npm publish metadata on all @zmdb packages + write per-package
// README, and copy the root LICENSE into each. Idempotent — run with `node`.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const REPO = 'https://github.com/ambasta/zmdb';
const VERSION = '1.0.0-alpha.3';

const META = {
  'schema-core': {
    description: 'Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, seeding, custom types, and an LLM tool harness — the single source of truth for a zmdb data layer.',
    keywords: ['typescript', 'orm', 'schema', 'dto', 'type-derivation', 'openapi', 'zmdb'],
  },
  'query-compiler': {
    description: 'SQL-first, dialect-aware query compiler: SELECT/INSERT/UPDATE/DELETE, joins, aggregations, full-text search, set operations, schema-object DDL, and migration diffing.',
    keywords: ['typescript', 'sql', 'query-builder', 'postgres', 'mysql', 'sqlite', 'migrations', 'zmdb'],
  },
  'aot-validator': {
    description: 'Ahead-of-time compiled validation and JSON Ser/De: is/assert/validate/equals/random, unions, transforms — inlined to straight-line JavaScript at build time, no runtime parser.',
    keywords: ['typescript', 'validation', 'aot', 'runtime-types', 'json', 'serialization', 'zmdb'],
  },
  repository: {
    description: 'Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, and framework adapters. No proxies, no identity map.',
    keywords: ['typescript', 'repository', 'crud', 'transactions', 'data-layer', 'zmdb'],
  },
};

for (const [name, m] of Object.entries(META)) {
  const dir = join(ROOT, 'packages', name);
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  // Ordered, publish-ready shape (preserve existing exports/engines/scripts).
  const next = {
    name: pkg.name,
    version: VERSION,
    description: m.description,
    keywords: m.keywords,
    license: 'GPL-3.0-or-later',
    author: 'zmdb contributors',
    homepage: `${REPO}#readme`,
    repository: { type: 'git', url: `git+${REPO}.git`, directory: `packages/${name}` },
    bugs: { url: `${REPO}/issues` },
    type: 'module',
    sideEffects: false,
    exports: pkg.exports,
    files: ['src', 'README.md', 'LICENSE'],
    engines: pkg.engines ?? { node: '>=26' },
    publishConfig: { access: 'public', tag: 'alpha' },
    scripts: pkg.scripts ?? { test: 'vitest run' },
  };
  writeFileSync(pkgPath, JSON.stringify(next, null, 2) + '\n');

  // Copy LICENSE.
  copyFileSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'));

  // Per-package README.
  const exportList = Object.keys(pkg.exports || { '.': '' })
    .map((e) => (e === '.' ? `\`${pkg.name}\`` : `\`${pkg.name}/${e.replace('./', '')}\``))
    .join(', ');
  const readme = `# ${pkg.name}

${m.description}

Part of **[zmdb](${REPO})** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

\`\`\`bash
npm add ${pkg.name}@alpha
\`\`\`

> **Prerelease** (\`${VERSION}\`, published under the \`alpha\` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM \`.js\` + \`.d.ts\` under
> \`./dist\`.

## Entry points

${exportList}

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
`;
  writeFileSync(join(dir, 'README.md'), readme);

  // Keep tests/specs out of the published tarball (files:['src'] would include them).
  writeFileSync(join(dir, '.npmignore'), ['*.spec.ts', '**/*.spec.ts', 'SPEC.md', '**/SPEC.md', ''].join('\n'));

  console.log(`prepared ${pkg.name} @ ${VERSION}`);
}
console.log('DONE');
