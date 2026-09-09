#!/usr/bin/env node
// Public product exports and import behavior in a fresh process.
// The consumer-product runner owns archive installation and the HTTP journey.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const TARGET_ROOT_VALUES = Object.freeze(
  [
    'AssertError',
    'Command',
    'Container',
    'Controller',
    'Delete',
    'EventPattern',
    'Gateway',
    'Get',
    'IncompleteKeyError',
    'Inject',
    'MessagePattern',
    'Module',
    'OnEvent',
    'Patch',
    'Post',
    'Public',
    'Put',
    'Subscribe',
    'ValidationError',
    'Version',
    'VersionNeutral',
    'assert',
    'createApp',
    'createApplication',
    'createCommandApp',
    'createEvents',
    'createToken',
    'defineConfig',
    'defineRepository',
    'is',
    'repositoryToken',
    'schemaOf',
    'validate',
  ].toSorted(),
);

export const REQUIRED_PRODUCT_SUBPATHS = Object.freeze(
  [
    '@zmdb/core/app',
    '@zmdb/core/app/commands',
    '@zmdb/core/app/cqrs',
    '@zmdb/core/app/data',
    '@zmdb/core/app/di',
    '@zmdb/core/app/events',
    '@zmdb/core/app/health',
    '@zmdb/core/app/lifecycle',
    '@zmdb/core/app/messaging',
    '@zmdb/core/app/modules',
    '@zmdb/core/app/observability',
    '@zmdb/core/app/state',
    '@zmdb/core/cli',
    '@zmdb/core/cockroach',
    '@zmdb/core/compiler',
    '@zmdb/core/config',
    '@zmdb/core/mssql',
    '@zmdb/core/migrations',
    '@zmdb/core/mysql',
    '@zmdb/core/orm',
    '@zmdb/core/postgres',
    '@zmdb/core/schema',
    '@zmdb/core/singlestore',
    '@zmdb/core/sql',
    '@zmdb/core/sqlite',
    '@zmdb/core/testing',
    '@zmdb/core/validator',
    '@zmdb/core/web',
    '@zmdb/core/web/app',
    '@zmdb/core/web/compression',
    '@zmdb/core/web/context',
    '@zmdb/core/web/contract',
    '@zmdb/core/web/contract/compiler',
    '@zmdb/core/web/csrf',
    '@zmdb/core/web/data',
    '@zmdb/core/web/devtools',
    '@zmdb/core/web/dto-pipes',
    '@zmdb/core/web/gateways',
    '@zmdb/core/web/health',
    '@zmdb/core/web/middleware',
    '@zmdb/core/web/openapi',
    '@zmdb/core/web/pipeline',
    '@zmdb/core/web/routing',
    '@zmdb/core/web/static',
    '@zmdb/core/web/testing',
    '@zmdb/core/web/upload',
    '@zmdb/core/web/versioning',
  ].toSorted(),
);

const FORBIDDEN_SPECIFIERS = [
  /^typescript(?:\/|$)/,
  /^oxfmt(?:\/|$)/,
  /^esbuild(?:\/|$)/,
  /^pg(?:\/|$)/,
  /^postgres(?:\/|$)/,
  /^mysql2?(?:\/|$)/,
  /^mssql(?:\/|$)/,
  /^tedious(?:\/|$)/,
  /^better-sqlite3(?:\/|$)/,
  /^sqlite3(?:\/|$)/,
  /^node:sqlite$/,
  /^@libsql\/client(?:\/|$)/,
  /^@neondatabase\/serverless(?:\/|$)/,
  /^@planetscale\/database(?:\/|$)/,
  /^@nats-io\/transport-node(?:\/|$)/,
  /^amqplib(?:\/|$)/,
  /^redis(?:\/|$)/,
  /^@opentelemetry\//,
  /^@grpc\/grpc-js(?:\/|$)/,
  /^next(?:\/|$)/,
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^@angular\//,
  /^vue(?:\/|$)/,
  /^nuxt(?:\/|$)/,
  /^svelte(?:\/|$)/,
];

function captureHookSource() {
  return `import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const output = process.env.ZMDB_PRODUCT_IMPORT_LOG;
if (output === undefined) throw new Error('ZMDB_PRODUCT_IMPORT_LOG is required');

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    appendFileSync(output, JSON.stringify({
      specifier,
      parentURL: context.parentURL ?? null,
      url: result.url,
    }) + '\\n');
    return result;
  },
});
`;
}

export function captureProductRootImport(root = ROOT) {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-product-import-'));
  const hook = join(temporary, 'capture.mjs');
  const log = join(temporary, 'imports.jsonl');
  writeFileSync(hook, captureHookSource());
  writeFileSync(log, '');

  try {
    const probe = spawnSync(
      'yarn',
      [
        'node',
        '--import',
        hook,
        '--import',
        join(root, 'scripts', 'ts-specifier-hook.mjs'),
        '--input-type=module',
        '--eval',
        "const product = await import('@zmdb/core'); console.log(JSON.stringify(Object.keys(product).toSorted()));",
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ZMDB_PRODUCT_IMPORT_LOG: log },
      },
    );

    const stdoutLines = probe.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    let runtimeNames = [];
    const last = stdoutLines.at(-1);
    if (last !== undefined) {
      try {
        const parsed = JSON.parse(last);
        if (Array.isArray(parsed) && parsed.every(name => typeof name === 'string')) {
          runtimeNames = parsed;
        }
      } catch {
        // The process result below preserves the parse failure as a useful problem.
      }
    }

    const imports = readFileSync(log, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        try {
          const parsed = JSON.parse(line);
          return typeof parsed.specifier === 'string' && typeof parsed.url === 'string' ? [parsed] : [];
        } catch {
          return [];
        }
      });

    return {
      status: probe.status,
      stdout: probe.stdout,
      stderr: probe.stderr,
      runtimeNames: runtimeNames.toSorted(),
      imports,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function logicalUrl(root, url) {
  if (!url.startsWith('file:')) return url;
  const path = fileURLToPath(url);
  const rel = relative(root, path);
  return rel.startsWith('..') ? path : rel;
}

export function inspectProductFacade(root = ROOT) {
  const captured = captureProductRootImport(root);
  const manifest = JSON.parse(readFileSync(join(root, 'packages', 'zmdb', 'package.json'), 'utf8'));
  const subpaths = Object.keys(manifest.exports ?? {})
    .filter(subpath => subpath !== '.')
    .map(subpath => `@zmdb/core${subpath.slice(1)}`)
    .toSorted();

  const forbiddenImports = [];
  for (const imported of captured.imports) {
    if (FORBIDDEN_SPECIFIERS.some(pattern => pattern.test(imported.specifier))) {
      forbiddenImports.push(`${imported.specifier} -> ${logicalUrl(root, imported.url)}`);
    }
  }

  return {
    processProblems:
      captured.status === 0 && captured.runtimeNames.length > 0
        ? []
        : [
            `importing @zmdb/core failed with status ${String(captured.status)}: ${
              captured.stderr.trim() || captured.stdout.trim() || 'no runtime export inventory'
            }`,
          ],
    runtimeNames: captured.runtimeNames,
    subpaths,
    missingSubpaths: REQUIRED_PRODUCT_SUBPATHS.filter(subpath => !subpaths.includes(subpath)),
    forbiddenImports: [...new Set(forbiddenImports)].toSorted(),
  };
}

async function main() {
  const report = inspectProductFacade(ROOT);
  const problems = [
    ...report.processProblems,
    ...(JSON.stringify(report.runtimeNames) === JSON.stringify(TARGET_ROOT_VALUES)
      ? []
      : [`root runtime exports differ: ${report.runtimeNames.join(', ')}`]),
    ...report.missingSubpaths.map(subpath => `missing product subpath ${subpath}`),
    ...report.forbiddenImports.map(path => `root import reaches ${path}`),
  ];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[ERROR] ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('Product facade exports, subpaths, and lazy root reachability verified.');
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  await main();
}
