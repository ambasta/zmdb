#!/usr/bin/env node
// Read-only product-facade and packed-consumer probes for issue #619.
//
// This file deliberately contains no facade implementation. It measures the
// public package in a fresh process, records the modules that process resolves,
// validates the external fixture's hygiene, and can run that fixture against
// real tarballs. The missing product surface remains an `it.fails` contract in
// packages/zmdb/src/product-surface.spec.ts.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PRODUCT_CATALOG } from '../../scripts/product/catalog.mjs';
import { releasePlan } from '../../scripts/release/plan.mjs';
import { publishManifest } from './lib/publish-manifest.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const TARGET_ROOT_VALUES = Object.freeze(
  [
    'AssertError',
    'Body',
    'Controller',
    'Delete',
    'Get',
    'IncompleteKeyError',
    'Module',
    'Patch',
    'Post',
    'Public',
    'Put',
    'ValidationError',
    'assert',
    'createApp',
    'defineConfig',
    'defineRepository',
    'is',
    'schemaOf',
    'validate',
  ].toSorted(),
);

export const TARGET_ROOT_TYPES = Object.freeze(
  [
    'App',
    'CreateDTO',
    'Ctx',
    'Driver',
    'Entity',
    'HasDefault',
    'Max',
    'MaxLength',
    'Min',
    'MinLength',
    'ModuleClass',
    'Pattern',
    'Physical',
    'PrimaryKey',
    'PrimaryKeyOf',
    'ReadDTO',
    'References',
    'Sensitive',
    'Serial',
    'Sql',
    'Table',
    'Unique',
    'UpdateDTO',
    'UpdatePatch',
    'ValidateResult',
    'ValidationIssue',
    'ZmdbConfig',
  ].toSorted(),
);

export const REQUIRED_PRODUCT_SUBPATHS = Object.freeze(
  [
    'zmdb/cli',
    'zmdb/compiler',
    'zmdb/config',
    'zmdb/drivers/mssql',
    'zmdb/drivers/pg',
    'zmdb/drivers/sqlite',
    'zmdb/migrations',
    'zmdb/orm',
    'zmdb/schema',
    'zmdb/sql',
    'zmdb/testing',
    'zmdb/validator',
    'zmdb/web',
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
  /^react(?:\/|$)/,
  /^@angular\//,
  /^vue(?:\/|$)/,
  /^nuxt(?:\/|$)/,
  /^svelte(?:\/|$)/,
];

const FORBIDDEN_PATHS = [
  /packages\/zmdb\/src\/cli\//,
  /packages\/zmdb\/src\/config\/index\.ts$/,
  /packages\/zmdb\/src\/studio\//,
  /packages\/zmdb\/src\/unplugin\.ts$/,
  /packages\/query-compiler\/src\/migrations\//,
  /packages\/aot-validator\/src\/(?:cli|codegen|emit|plugin|reflect|transformer)\//,
];

function namesFromExportBlock(body) {
  return body
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const withoutType = part.replace(/^type\s+/, '');
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(withoutType);
      return alias?.[1] ?? /^[A-Za-z_$][\w$]*/.exec(withoutType)?.[0];
    })
    .filter(name => name !== undefined)
    .toSorted();
}

function packageName(specifier) {
  const match = /^(@[^/]+\/[^/]+|[^@./][^/]*)(?:\/|$)/.exec(specifier);
  return match?.[1] ?? 'zmdb';
}

function consumerSubpath(packageNameValue, subpath) {
  return subpath === '.' ? packageNameValue : `${packageNameValue}${subpath.slice(1)}`;
}

function rootSourceOwnership(root) {
  const path = join(root, 'packages', 'zmdb', 'src', 'index.ts');
  const source = readFileSync(path, 'utf8');
  const values = [];
  const types = [];

  for (const match of source.matchAll(/export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, typeKeyword, body = '', specifier = ''] = match;
    const owner = specifier.startsWith('.') ? 'zmdb' : packageName(specifier);
    const target = typeKeyword === undefined ? values : types;
    for (const name of namesFromExportBlock(body)) {
      target.push({ name, owner });
    }
  }

  for (const match of source.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, name = '', specifier = ''] = match;
    values.push({ name, owner: specifier.startsWith('.') ? 'zmdb' : packageName(specifier) });
  }

  return {
    values: values.toSorted((left, right) => left.name.localeCompare(right.name)),
    types: types.toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

export function readFacadeOwnership(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', 'zmdb', 'package.json'), 'utf8'));
  const rootOwnership = rootSourceOwnership(root);
  const subpaths = [];
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (subpath === '.' || typeof target !== 'string') continue;
    subpaths.push({ name: consumerSubpath('zmdb', subpath) });
  }
  return {
    root: [...rootOwnership.values, ...rootOwnership.types].toSorted((left, right) =>
      `${left.name}\u0000${left.owner}`.localeCompare(`${right.name}\u0000${right.owner}`),
    ),
    subpaths: subpaths.toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

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
        "const product = await import('zmdb'); console.log(JSON.stringify(Object.keys(product).toSorted()));",
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
  const ownership = rootSourceOwnership(root);
  const manifest = JSON.parse(readFileSync(join(root, 'packages', 'zmdb', 'package.json'), 'utf8'));
  const subpaths = Object.keys(manifest.exports ?? {})
    .map(subpath => consumerSubpath('zmdb', subpath))
    .filter(name => name !== 'zmdb')
    .toSorted();

  const forbiddenImports = [];
  for (const imported of captured.imports) {
    const logical = logicalUrl(root, imported.url);
    if (
      FORBIDDEN_SPECIFIERS.some(pattern => pattern.test(imported.specifier)) ||
      FORBIDDEN_PATHS.some(pattern => pattern.test(logical))
    ) {
      forbiddenImports.push(`${imported.specifier} -> ${logical}`);
    }
  }

  return {
    processProblems:
      captured.status === 0 && captured.runtimeNames.length > 0
        ? []
        : [
            `importing zmdb failed with status ${String(captured.status)}: ${
              captured.stderr.trim() || captured.stdout.trim() || 'no runtime export inventory'
            }`,
          ],
    runtimeNames: captured.runtimeNames,
    typeNames: ownership.types.map(item => item.name).toSorted(),
    subpaths,
    missingSubpaths: REQUIRED_PRODUCT_SUBPATHS.filter(subpath => !subpaths.includes(subpath)),
    forbiddenImports: [...new Set(forbiddenImports)].toSorted(),
    ownership: readFacadeOwnership(root),
  };
}

function allFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(specifier ?? '');
  }
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(specifier ?? '');
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
    specifiers.push(specifier ?? '');
  }
  return specifiers;
}

export function inspectProductConsumerFixture(fixture) {
  const problems = [];
  const manifestPath = join(fixture, 'package.json');
  const tsconfigPath = join(fixture, 'tsconfig.consumer.json');
  if (!existsSync(manifestPath)) {
    problems.push('consumer-product package.json is missing');
    return problems;
  }
  if (!existsSync(tsconfigPath)) {
    problems.push('consumer-product tsconfig.consumer.json is missing');
    return problems;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const zmdbDependencies = dependencyFields.flatMap(field =>
    Object.keys(manifest[field] ?? {})
      .filter(name => name === 'zmdb' || name.startsWith('@zmdb/'))
      .map(name => `${field}:${name}`),
  );
  if (JSON.stringify(zmdbDependencies) !== JSON.stringify(['dependencies:zmdb'])) {
    problems.push(
      `consumer-product must declare only dependencies:zmdb, found ${zmdbDependencies.join(', ') || 'none'}`,
    );
  }
  const zmdbRange = manifest.dependencies?.zmdb;
  if (
    typeof zmdbRange !== 'string' ||
    /^(?:workspace|file|link|portal|patch):/.test(zmdbRange) ||
    zmdbRange.includes('/')
  ) {
    problems.push(`consumer-product zmdb dependency is not a registry range: ${JSON.stringify(zmdbRange)}`);
  }

  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  if (tsconfig.compilerOptions?.paths !== undefined) {
    problems.push('consumer-product tsconfig must not declare compilerOptions.paths');
  }
  if (tsconfig.compilerOptions?.skipLibCheck === true) {
    problems.push('consumer-product tsconfig must not enable skipLibCheck');
  }
  if (tsconfig.compilerOptions?.allowImportingTsExtensions !== false) {
    problems.push('consumer-product must keep allowImportingTsExtensions=false');
  }

  for (const path of allFiles(fixture)) {
    const source = readFileSync(path, 'utf8');
    if (source.includes('workspace:')) {
      problems.push(`${relative(fixture, path)} contains a workspace protocol`);
    }
    if (!/\.[cm]?[jt]s$/.test(path)) continue;
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('@zmdb/')) {
        problems.push(`${relative(fixture, path)} imports internal package ${specifier}`);
      }
      if (specifier.startsWith('.') && !/\.(?:[cm]?js|json)$/.test(specifier)) {
        problems.push(`${relative(fixture, path)} uses relative specifier ${specifier} without a runtime extension`);
      }
    }
  }
  return problems.toSorted();
}

function installLink(root, app, name) {
  const target = join(root, 'node_modules', name);
  if (!existsSync(target)) return;
  const link = join(app, 'node_modules', name);
  if (existsSync(link)) return;
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, 'dir');
}

function failure(stage, result) {
  return {
    stage,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function packedConsumerBuildSource() {
  return `import { readFile } from 'node:fs/promises';

import { build } from 'esbuild';
import { zmdbAot } from 'zmdb/compiler';

const [entry, outfile] = process.argv.slice(2);
if (entry === undefined || outfile === undefined) {
  throw new Error('usage: node build.mjs <entry> <outfile>');
}

const compiler = await zmdbAot({ cwd: process.cwd() });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  packages: 'external',
  platform: 'node',
  target: 'node26',
  logLevel: 'silent',
  plugins: [{
    name: compiler.name,
    setup(esbuild) {
      esbuild.onLoad({ filter: /\\.[cm]?tsx?$/ }, async ({ path }) => {
        const code = await readFile(path, 'utf8');
        const transformed = await compiler.transform(code, path);
        return {
          contents: transformed?.code ?? code,
          loader: path.endsWith('x') ? 'tsx' : 'ts',
        };
      });
      esbuild.onEnd(() => compiler.buildEnd?.());
    },
  }],
});
`;
}

export function runPackedProductConsumer(root = ROOT, fixture = join(root, 'fixtures', 'consumer-product')) {
  const build = spawnSync('yarn', ['build'], { cwd: root, encoding: 'utf8' });
  if (build.status !== 0) return failure('build', build);
  const commonVersion = releasePlan(root).version;

  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-product-consumer-'));
  const stage = join(temporary, 'stage');
  const app = join(temporary, 'app');
  mkdirSync(stage, { recursive: true });
  cpSync(fixture, app, { recursive: true });
  mkdirSync(join(app, 'node_modules'), { recursive: true });

  try {
    for (const row of PRODUCT_CATALOG) {
      const source = join(root, row.directory);
      const staged = join(stage, row.id);
      cpSync(source, staged, {
        recursive: true,
        dereference: true,
        filter: path => !path.includes(join(source, 'node_modules')),
      });
      const manifest = publishManifest(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')), commonVersion);
      writeFileSync(join(staged, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

      const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', temporary], {
        cwd: staged,
        encoding: 'utf8',
        env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
      });
      if (packed.status !== 0) return failure(`pack:${manifest.name}`, packed);
      const report = JSON.parse(packed.stdout);
      const entry = Array.isArray(report) ? report[0] : Object.values(report)[0];
      const destination = join(app, 'node_modules', manifest.name);
      mkdirSync(destination, { recursive: true });
      const extracted = spawnSync(
        'tar',
        ['-xzf', join(temporary, entry.filename), '-C', destination, '--strip-components=1'],
        { encoding: 'utf8' },
      );
      if (extracted.status !== 0) return failure(`extract:${manifest.name}`, extracted);
    }

    for (const peer of ['typescript', 'esbuild', 'oxfmt', '@types/node']) {
      installLink(root, app, peer);
    }

    mkdirSync(join(app, 'dist'), { recursive: true });
    const database = join(app, 'product.sqlite');
    const buildScript = join(app, 'build.mjs');
    const entry = join(app, 'src', 'main.ts');
    const output = join(app, 'dist', 'main.mjs');
    writeFileSync(buildScript, packedConsumerBuildSource());
    const bundled = spawnSync(process.execPath, [buildScript, entry, output], {
      cwd: app,
      encoding: 'utf8',
      env: { ...process.env, ZMDB_PRODUCT_DATABASE: database },
    });
    if (bundled.status !== 0) return failure('bundle', bundled);

    const executed = spawnSync(process.execPath, [output], {
      cwd: app,
      encoding: 'utf8',
      env: { ...process.env, ZMDB_PRODUCT_DATABASE: database },
    });
    return failure('execute', executed);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function main() {
  const report = inspectProductFacade(ROOT);
  const problems = [
    ...report.processProblems,
    ...(JSON.stringify(report.runtimeNames) === JSON.stringify(TARGET_ROOT_VALUES)
      ? []
      : [`root runtime exports differ: ${report.runtimeNames.join(', ')}`]),
    ...(JSON.stringify(report.typeNames) === JSON.stringify(TARGET_ROOT_TYPES)
      ? []
      : [`root type exports differ: ${report.typeNames.join(', ')}`]),
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
  main();
}
