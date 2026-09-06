#!/usr/bin/env node
// The publish smoke test: pack what would be published, install it into a throwaway
// project, and then both *load* and *typecheck* every subpath from outside the repo.
//
// `verify:exports` cannot do this job, and for a while it looked like it could. It
// imports every subpath under plain `node` — but it does so from the workspace root,
// where `node_modules/@zmdb/schema-core` is a symlink into `packages/`. Node resolves
// the realpath, so the file it loads is not under `node_modules`, and the committed
// manifest's `./src/index.ts` target works. Install the same package for real and it
// does not:
//
//   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING: Stripping types is currently
//   unsupported for files under node_modules
//
// Every green check in the repo was compatible with a package that could not be
// imported once installed. That is the class of failure this script exists for, so it
// deliberately does the boring, expensive thing: `npm pack`, extract, resolve from a
// directory that is not this one.
//
// It checks three surfaces, because they fail independently:
//   * runtime — `import(specifier)` in a child process whose cwd is the temp project.
//   * types — a generated consumer module that imports every subpath's types, compiled
//     by `tsc` with no `paths` mapping and no `skipLibCheck`, so a declaration that
//     cannot resolve its own neighbours is an error rather than a surprise later.
//   * executable — the installed `zmdb` bin starts Studio on loopback and serves a
//     declared table, catching lazy syntax that importing `zmdb/cli` never reaches.
//
// Plus one thing neither surface reports: a `.d.ts` whose relative specifiers still end
// in `.ts`. `tsc` substitutes the extension and resolves it anyway, which is why this is
// asserted directly instead of being left to the typecheck to notice.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PACKAGES, ROOT, publishManifest, readManifest } from './lib/publish-manifest.mjs';
import { inspectProductConsumerFixture } from './verify-product-facade.mjs';
import {
  TARGET_PRODUCT_TOOLING_EXPORTS,
  TARGET_TOOLING_BIN,
  TARGET_TOOLING_EXPORTS,
  TARGET_TOOLING_MANIFESTS,
} from './verify-tooling-boundaries.mjs';

// Build-time and optional integration subpaths reach their peers on purpose (see
// `verify-exports.mjs`), so the temp project needs what a consumer of every advertised
// subpath would already have.
const PEERS = [
  '@angular/core',
  '@sveltejs/kit',
  'typescript',
  'svelte',
  'pg',
  '@types/node',
  '@types/pg',
  '@types/react',
  '@anthropic-ai/sdk',
  '@langchain/core',
  '@grpc/grpc-js',
  '@opentelemetry/api',
  'metro',
  'metro-babel-transformer',
  '@nats-io/transport-node',
  'amqplib',
  'redis',
  'react',
  'rxjs',
  'solid-js',
  'nuxt',
  'vue',
  'react-dom',
  'next',
  'server-only',
];
const CUSTOM_TRANSPORT_FIXTURE = join(ROOT, 'fixtures', 'app-custom-transport.ts');
const PRODUCT_CONSUMER_FIXTURE = join(ROOT, 'fixtures', 'consumer-product');
const HTTP_CLIENT_DOCS_FIXTURE = join(ROOT, 'fixtures', 'consumer-http-client', 'docs');
const HTTP_CLIENT_DOCS_PAGE = join(ROOT, 'docs-site', 'content', 'generated-client.md');
const HTTP_CLIENT_DOCS_TSCONFIG = join(ROOT, 'fixtures', 'consumer-http-client', 'tsconfig.docs.json');
const HTTP_CLIENT_CONSUMER_FIXTURE = join(ROOT, 'fixtures', 'consumer-http-client', 'verify-installed.mjs');
const ADMITTED_PACKAGE_NAMES = new Set(PACKAGES.map(name => readManifest(name).name));

const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

/** Every `.d.ts` under `dir`, recursively. */
function declarations(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return declarations(path);
    return entry.isFile() && entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Every `.js` under `dir`, recursively. */
function javascript(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return javascript(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

let errors = 0;
const fail = message => {
  console.error(`[ERROR] ${message}`);
  errors++;
};

const messageOf = error => (error instanceof Error ? error.message : String(error));

function generatedClientExamples() {
  const lines = readFileSync(HTTP_CLIENT_DOCS_PAGE, 'utf8').split('\n');
  const examples = [];
  const files = new Set();

  for (let index = 0; index < lines.length; index++) {
    if (!/^```(?:ts|typescript)$/.test(lines[index] ?? '')) continue;
    const code = [];
    index++;
    while (index < lines.length && lines[index] !== '```') {
      code.push(lines[index] ?? '');
      index++;
    }
    const marker = /^\/\/ docs-file: ([A-Za-z0-9._/-]+)$/.exec(code[0] ?? '');
    if (marker === null) throw new Error('generated-client.md TypeScript fence has no docs-file marker');
    const file = marker[1];
    if (file.startsWith('/') || file.split('/').some(segment => ['', '.', '..'].includes(segment))) {
      throw new Error(`generated-client.md has unsafe docs-file marker ${file}`);
    }
    if (files.has(file)) throw new Error(`generated-client.md repeats docs-file marker ${file}`);
    files.add(file);
    examples.push({ file, source: `${code.join('\n').trimEnd()}\n` });
  }
  return examples;
}

async function smokeStudio(app, binPath) {
  const configPath = join(app, 'zmdb.config.mjs');
  writeFileSync(
    configPath,
    `export default {
  schema: './schema.ts',
  dialect: 'sqlite',
  project: './tsconfig.json',
  driver: () => ({
    dialect: 'sqlite',
    execute: () => Promise.resolve([]),
  }),
  http: {
    contracts: './schema.ts#WIDGET_HTTP_CONTRACT',
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
};
`,
  );
  writeFileSync(
    join(app, 'schema.ts'),
    `import type { PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface Widget extends Table<'widgets'> {
  id: number & Sql<'integer'> & PrimaryKey;
}

export const WIDGET_HTTP_CONTRACT = {};
`,
  );
  writeFileSync(
    join(app, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
        },
        include: ['schema.ts'],
      },
      null,
      2,
    )}\n`,
  );

  const configProbe = run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { join } from 'node:path';
const configModule = await import('zmdb/config');
const authored = {
  schema: './schema.ts',
  dialect: 'sqlite',
  project: './tsconfig.json',
  out: './migrations',
  http: {
    contracts: './schema.ts#WIDGET_HTTP_CONTRACT',
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
};
if (configModule.defineConfig(authored) !== authored) throw new Error('defineConfig lost identity');
const first = await configModule.loadConfig({ cwd: process.cwd() });
const second = await configModule.loadConfig({ cwd: process.cwd(), path: './zmdb.config.mjs' });
if (first !== second) throw new Error('path-keyed config cache lost identity');
const direct = await configModule.resolveConfig(authored, join(process.cwd(), 'zmdb.config.mjs'));
for (const loaded of [first, direct]) {
  if (loaded.project !== join(process.cwd(), 'tsconfig.json')) throw new Error('project path was not canonical');
  if (loaded.outDir !== join(process.cwd(), 'migrations')) throw new Error('output path was not canonical');
  if (loaded.http?.contracts[0]?.file !== join(process.cwd(), 'schema.ts')) {
    throw new Error('HTTP contract path was not canonical');
  }
  if (loaded.http?.contracts[0]?.exportName !== 'WIDGET_HTTP_CONTRACT') {
    throw new Error('HTTP contract export was not preserved');
  }
  if (loaded.http?.openApiOut !== join(process.cwd(), 'generated', 'openapi.json')) {
    throw new Error('OpenAPI output path was not canonical');
  }
  if (loaded.http?.clientOut !== join(process.cwd(), 'generated', 'http-client.generated.ts')) {
    throw new Error('client output path was not canonical');
  }
}
process.stdout.write('packed-config-contract-ok');
`,
    ],
    { cwd: app },
  );
  if (configProbe.status !== 0 || configProbe.stdout !== 'packed-config-contract-ok') {
    throw new Error(`packed config contract failed: ${configProbe.stdout}${configProbe.stderr}`);
  }

  const child = spawn(process.execPath, [binPath, 'studio', '--config', configPath, '--port', '0'], {
    cwd: app,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const exited = new Promise(resolveExit => {
    child.once('exit', (code, signal) => {
      resolveExit({ code, signal });
    });
  });

  try {
    const url = await new Promise((resolveUrl, rejectUrl) => {
      const timeout = setTimeout(() => {
        rejectUrl(new Error(`timed out waiting for the Studio URL; stdout=${stdout.trim()} stderr=${stderr.trim()}`));
      }, 30_000);
      const finish = action => {
        clearTimeout(timeout);
        child.stdout.off('data', inspect);
        child.off('error', onError);
        child.off('exit', onExit);
        action();
      };
      const inspect = () => {
        const line = stdout.split(/\r?\n/).find(candidate => /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(candidate));
        if (line !== undefined) finish(() => resolveUrl(line));
      };
      const onError = error => {
        finish(() => rejectUrl(error));
      };
      const onExit = (code, signal) => {
        finish(() =>
          rejectUrl(
            new Error(
              `Studio exited before listening (code=${String(code)}, signal=${String(signal)}): ${stderr.trim()}`,
            ),
          ),
        );
      };
      child.stdout.on('data', inspect);
      child.once('error', onError);
      child.once('exit', onExit);
      inspect();
    });

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const html = await response.text();
    if (response.status !== 200) throw new Error(`GET ${url} returned ${String(response.status)}`);
    if (!/local raw-data viewer/i.test(html)) throw new Error('Studio index omitted its read-only warning');
    if (!html.includes('widgets')) throw new Error('Studio index omitted the declared widgets table');

    child.kill('SIGTERM');
    const result = await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => rejectExit(new Error('Studio did not stop after SIGTERM')), 10_000);
      void exited.then(value => {
        clearTimeout(timeout);
        resolveExit(value);
      });
    });
    if (result.code !== 0) {
      throw new Error(
        `Studio stopped with code=${String(result.code)}, signal=${String(result.signal)}: ${stderr.trim()}`,
      );
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

// 1. Build. The gate is self-contained on purpose: a stale `dist` would make this pass
//    against output nobody has any more.
console.log('Building every package (topological)...');
if (run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
  console.error('[ERROR] yarn build failed');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'zmdb-publish-'));
const stage = join(tmp, 'stage');
const app = join(tmp, 'app');
mkdirSync(stage, { recursive: true });
mkdirSync(join(app, 'node_modules'), { recursive: true });
writeFileSync(
  join(app, 'package.json'),
  `${JSON.stringify({ name: 'zmdb-publish-smoke', private: true, type: 'module' }, null, 2)}\n`,
);

for (const peer of PEERS) {
  const target = join(ROOT, 'node_modules', peer);
  const link = join(app, 'node_modules', peer);
  mkdirSync(join(link, '..'), { recursive: true });
  try {
    symlinkSync(target, link, 'dir');
  } catch {
    console.log(`  (peer ${peer} not installed at the root; build-time subpaths may not load)`);
  }
}

// 2. Pack each package from a staged copy carrying the *publish* manifest, so `npm pack`
//    applies the real `files` list and `.npmignore` rather than the dev ones.
const specifiers = [];
const packedTarballs = new Map();
let studioBin;
for (const name of PACKAGES) {
  const pkg = publishManifest(readManifest(name));
  const src = join(ROOT, 'packages', name);
  const dst = join(stage, name);

  cpSync(src, dst, {
    recursive: true,
    dereference: true,
    filter: p => !p.includes(`${join(src, 'node_modules')}`),
  });
  writeFileSync(join(dst, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  const packed = run('npm', ['pack', '--json', '--pack-destination', tmp], {
    cwd: dst,
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  if (packed.status !== 0) {
    fail(`npm pack failed for ${pkg.name}: ${packed.stderr?.trim()}`);
    continue;
  }
  // `npm pack --json` reports an array on npm 10 and an object keyed by package name on
  // npm 11. Take the one entry either way rather than pinning a shape.
  const report = JSON.parse(packed.stdout);
  const { filename } = Array.isArray(report) ? report[0] : Object.values(report)[0];
  packedTarballs.set(pkg.name, join(tmp, filename));
  const into = join(app, 'node_modules', pkg.name);
  mkdirSync(into, { recursive: true });
  // The tarball's single root directory is always `package/`.
  const untar = run('tar', ['-xzf', join(tmp, filename), '-C', into, '--strip-components=1']);
  if (untar.status !== 0) {
    fail(`could not extract ${filename}: ${untar.stderr?.trim()}`);
    continue;
  }

  for (const subpath of Object.keys(pkg.exports)) {
    specifiers.push(subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`);
  }
  const expectedToolingExports = TARGET_TOOLING_EXPORTS[pkg.name];
  if (expectedToolingExports !== undefined) {
    const observed = Object.keys(pkg.exports).toSorted();
    if (JSON.stringify(observed) !== JSON.stringify([...expectedToolingExports].toSorted())) {
      fail(
        `${pkg.name} packed exports ${JSON.stringify(observed)}, expected ${JSON.stringify(expectedToolingExports)}`,
      );
    }
    const contract = TARGET_TOOLING_MANIFESTS[pkg.name];
    const dependencies = Object.keys(pkg.dependencies ?? {}).toSorted();
    if (JSON.stringify(dependencies) !== JSON.stringify([...contract.dependencies].toSorted())) {
      fail(
        `${pkg.name} packed dependencies ${JSON.stringify(dependencies)}, expected ${JSON.stringify(contract.dependencies)}`,
      );
    }
    const peers = Object.keys(pkg.peerDependencies ?? {}).toSorted();
    if (JSON.stringify(peers) !== JSON.stringify([...contract.peerDependencies].toSorted())) {
      fail(`${pkg.name} packed peers ${JSON.stringify(peers)}, expected ${JSON.stringify(contract.peerDependencies)}`);
    }
    for (const peer of contract.peerDependencies) {
      const optional = pkg.peerDependenciesMeta?.[peer]?.optional === true;
      if (optional !== contract.optionalPeers.includes(peer)) {
        fail(
          `${pkg.name} packed peer ${peer} optional=${String(optional)}, ` +
            `expected ${String(contract.optionalPeers.includes(peer))}`,
        );
      }
    }
  }
  if (pkg.name === 'zmdb') {
    for (const [toolingPackage, subpaths] of Object.entries(TARGET_PRODUCT_TOOLING_EXPORTS)) {
      if (!ADMITTED_PACKAGE_NAMES.has(toolingPackage)) continue;
      if (pkg.dependencies?.[toolingPackage] === undefined) {
        fail(`zmdb packed manifest does not depend on ${toolingPackage}`);
      }
      for (const subpath of subpaths) {
        if (typeof pkg.exports?.[subpath] !== 'string') {
          fail(`zmdb packed manifest is missing ${subpath} for ${toolingPackage}`);
        }
      }
    }
  }
  if (pkg.bin) {
    const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin;
    if (
      pkg.name === TARGET_TOOLING_BIN.packageName &&
      JSON.stringify(Object.keys(bins)) !== JSON.stringify([TARGET_TOOLING_BIN.command])
    ) {
      fail(`${pkg.name} packed bins ${JSON.stringify(Object.keys(bins))}, expected ["${TARGET_TOOLING_BIN.command}"]`);
    }
    for (const [command, target] of Object.entries(bins)) {
      const binPath = join(into, target);
      const source = (() => {
        try {
          return readFileSync(binPath, 'utf8');
        } catch {
          return null;
        }
      })();
      if (source === null) fail(`${pkg.name} bin "${command}" → ${target} is not in the tarball`);
      else if (!source.startsWith('#!')) fail(`${pkg.name} bin "${command}" has no shebang`);
      if (pkg.name === 'zmdb' && command === 'zmdb') studioBin = binPath;
    }
  }
  for (const file of declarations(join(into, 'dist'))) {
    const source = readFileSync(file, 'utf8');
    const stale = [...source.matchAll(/(?:from|import\s*\()\s*['"](\.\.?\/[^'"]*\.tsx?)['"]/g)];
    for (const [, specifier] of stale) {
      fail(`${pkg.name} ships ${file.slice(into.length + 1)} with a source specifier: ${specifier}`);
    }
  }
  console.log(`  installed ${pkg.name} (${Object.keys(pkg.exports).length} subpaths)`);
}

// 3. Load every ordinary subpath from the temp project. The Next server entry
// deliberately rejects a plain import and is qualified separately below.
const NEXT_SERVER_SPECIFIER = '@zmdb/next/server';
const ordinarySpecifiers = specifiers.filter(specifier => specifier !== NEXT_SERVER_SPECIFIER);
writeFileSync(
  join(app, 'smoke.mjs'),
  `${[
    'let failed = 0;',
    `for (const specifier of ${JSON.stringify(ordinarySpecifiers)}) {`,
    '  try {',
    '    await import(specifier);',
    '  } catch (error) {',
    "    console.error(`  import('${specifier}') -> ${error.code ?? ''} ${error.message}`);",
    '    failed++;',
    '  }',
    '}',
    'process.exit(failed > 0 ? 1 : 0);',
  ].join('\n')}\n`,
);
console.log(`Importing ${ordinarySpecifiers.length} ordinary subpath(s) from an installed tree...`);
if (run('node', ['smoke.mjs'], { cwd: app, stdio: 'inherit' }).status !== 0) {
  fail('at least one subpath does not import from an installed tree');
}
if (specifiers.includes(NEXT_SERVER_SPECIFIER)) {
  const guarded = run(
    'node',
    ['--input-type=module', '--eval', `await import(${JSON.stringify(NEXT_SERVER_SPECIFIER)})`],
    { cwd: app },
  );
  if (
    guarded.status === 0 ||
    !guarded.stderr?.includes('This module cannot be imported from a Client Component module')
  ) {
    fail(`installed ${NEXT_SERVER_SPECIFIER} did not enforce its plain-node guard: ${guarded.stderr?.trim()}`);
  }
  const server = run(
    'node',
    [
      '--conditions=react-server',
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(NEXT_SERVER_SPECIFIER)})`,
    ],
    { cwd: app },
  );
  if (server.status !== 0) {
    fail(`installed ${NEXT_SERVER_SPECIFIER} does not import under react-server: ${server.stderr?.trim()}`);
  }
}

// 4. Parse and execute the installed Studio path. Importing `zmdb/cli` is not
// enough: ESNext emit can preserve decorator syntax that plain Node rejects only
// when the lazy Studio module is loaded.
const studioDirectory = join(app, 'node_modules', 'zmdb', 'dist', 'studio');
for (const file of javascript(studioDirectory)) {
  const checked = run('node', ['--check', file]);
  if (checked.status !== 0) {
    fail(`plain Node cannot parse ${file.slice(app.length + 1)}: ${checked.stderr?.trim()}`);
  }
}
if (studioBin === undefined) {
  fail('the installed zmdb package did not expose its canonical bin');
} else {
  try {
    await smokeStudio(app, studioBin);
    console.log('  executed installed zmdb Studio bin and fetched its loopback index');
  } catch (error) {
    fail(`installed "zmdb studio --port 0" smoke failed: ${messageOf(error)}`);
  }
}

// 5. Typecheck a consumer against the published declarations.
const METRO_SUBPATH = '@zmdb/aot-validator/metro';
const BROWSER_FRAMEWORK_PACKAGES = ['@zmdb/svelte', '@zmdb/sveltekit', '@zmdb/vue'];
const browserSpecifiers = specifiers.filter(specifier =>
  BROWSER_FRAMEWORK_PACKAGES.some(packageName => specifier === packageName || specifier.startsWith(`${packageName}/`)),
);
const nuxtSpecifiers = specifiers.filter(
  specifier => specifier === '@zmdb/nuxt' || specifier.startsWith('@zmdb/nuxt/'),
);
const strictSpecifiers = specifiers.filter(
  specifier =>
    specifier !== METRO_SUBPATH && !browserSpecifiers.includes(specifier) && !nuxtSpecifiers.includes(specifier),
);
writeFileSync(
  join(app, 'consumer.ts'),
  `${[
    '// Generated by .github/scripts/verify-publish.mjs. Every published subpath, as a',
    '// consumer sees it: no `paths` mapping, no source in reach, only the shipped .d.ts.',
    ...strictSpecifiers.map((specifier, i) => `import type * as ns${i} from '${specifier}';`),
    '',
    `export type Surface = [${strictSpecifiers.map((_, i) => `typeof ns${i}`).join(', ')}];`,
  ].join('\n')}\n`,
);
writeFileSync(
  join(app, 'config-consumer.ts'),
  `import {
  defineConfig,
  type HttpGenerationConfig,
  type ResolvedConfig,
  type ZmdbConfig,
} from 'zmdb/config';

const http = {
  contracts: './src/http.contract.ts#HTTP_CONTRACT',
  openApi: { out: './generated/openapi.json' },
  client: { out: './generated/http-client.generated.ts' },
} satisfies HttpGenerationConfig;

export const config = defineConfig({
  schema: './src/schema.ts',
  dialect: 'sqlite',
  http,
});

const accepted: ZmdbConfig = config;
declare const resolved: ResolvedConfig;
void accepted;
void resolved.http?.contracts[0]?.exportName;
void resolved.http?.openApiOut;
void resolved.http?.clientOut;
`,
);
// This is deliberately copied outside the repository before compilation. It
// implements the custom transport contract using only published subpaths, so a
// private relative import or a source-only named export cannot pass here.
// The all-subpath consumer also installs each required framework peer. Angular's
// public declarations use browser globals, so the consumer includes the same DOM
// libraries as a real Angular application without weakening declaration checking.
cpSync(CUSTOM_TRANSPORT_FIXTURE, join(app, 'app-custom-transport.ts'));
writeFileSync(
  join(app, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        lib: ['ESNext', 'DOM', 'DOM.Iterable'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        types: ['node'],
      },
      include: ['config-consumer.ts', 'consumer.ts', 'app-custom-transport.ts'],
    },
    null,
    2,
  )}\n`,
);
console.log('Typechecking a consumer against the published declarations...');
const tsc = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], { cwd: app, stdio: 'inherit' });
if (tsc.status !== 0) fail('the published declarations do not typecheck from a consumer project');

writeFileSync(
  join(app, 'browser-consumer.ts'),
  `${[
    '// Generated by .github/scripts/verify-publish.mjs. Browser-framework declarations',
    '// compile without Node globals, source paths, or skipped library checks.',
    ...browserSpecifiers.map((specifier, i) => `import type * as browserNs${i} from '${specifier}';`),
    '',
    `export type BrowserSurface = [${browserSpecifiers.map((_, i) => `typeof browserNs${i}`).join(', ')}];`,
  ].join('\n')}\n`,
);
writeFileSync(
  join(app, 'tsconfig.browser.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        lib: ['ESNext', 'DOM', 'DOM.Iterable'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        types: [],
      },
      include: ['browser-consumer.ts'],
    },
    null,
    2,
  )}\n`,
);
console.log('Typechecking browser-framework declarations without Node globals...');
const browserTsc = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.browser.json'], {
  cwd: app,
  stdio: 'inherit',
});
if (browserTsc.status !== 0) fail('the browser-framework declarations do not typecheck from a consumer project');

// Nuxt 4.5's public declaration graph names optional webpack, Vue-language and
// alternative-bundler packages that a normal Vite/Nitro application does not
// install. Keep the library skip scoped to that upstream graph. The package's
// own declarations and call sites are still checked by its build/type tests and
// by the packed Nuxt fixture that builds and renders a real application.
writeFileSync(
  join(app, 'nuxt-consumer.ts'),
  `${[
    '// Generated by .github/scripts/verify-publish.mjs. Nuxt declarations compile',
    '// from installed tarballs while ignoring Nuxt-owned optional tool declarations.',
    ...nuxtSpecifiers.map((specifier, i) => `import type * as nuxtNs${i} from '${specifier}';`),
    '',
    `export type NuxtSurface = [${nuxtSpecifiers.map((_, i) => `typeof nuxtNs${i}`).join(', ')}];`,
  ].join('\n')}\n`,
);
writeFileSync(
  join(app, 'tsconfig.nuxt.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        lib: ['ESNext', 'DOM', 'DOM.Iterable'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['nuxt-consumer.ts'],
    },
    null,
    2,
  )}\n`,
);
console.log('Typechecking installed Nuxt declarations with its optional tool declarations skipped...');
const nuxtTsc = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.nuxt.json'], {
  cwd: app,
  stdio: 'inherit',
});
if (nuxtTsc.status !== 0) fail('the published Nuxt declarations do not typecheck from a consumer project');

// The generated-client page is executable documentation. The focused docs test
// validates its exact safe file markers; this copy writes those exact fence
// bytes outside the repository and compiles them against only the declarations
// extracted from the tarballs above.
const generatedClientDocs = join(app, 'generated-client-docs');
cpSync(HTTP_CLIENT_DOCS_FIXTURE, generatedClientDocs, { recursive: true });
for (const example of generatedClientExamples()) {
  const target = join(generatedClientDocs, example.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, example.source);
}
mkdirSync(join(generatedClientDocs, 'generated'), { recursive: true });
cpSync(
  join(ROOT, 'fixtures', 'consumer-http-client', 'generated', 'http-client.generated.ts'),
  join(generatedClientDocs, 'generated', 'http-client.generated.ts'),
);
cpSync(HTTP_CLIENT_DOCS_TSCONFIG, join(generatedClientDocs, 'tsconfig.json'));
console.log('Typechecking every generated-client example against packed declarations...');
const generatedClientDocsTsc = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], {
  cwd: generatedClientDocs,
  stdio: 'inherit',
});
if (generatedClientDocsTsc.status !== 0) {
  fail('a generated-client documentation example does not typecheck against packed declarations');
}

// The one-install product fixture remains an expected-failure runtime journey
// until #620–#623 land, but its external-package boundary is already part of
// publish verification: one registry dependency, no workspace paths, no
// internal imports, no skipLibCheck, and a strict compile against the packed
// declarations rather than workspace sources.
for (const problem of inspectProductConsumerFixture(PRODUCT_CONSUMER_FIXTURE)) {
  fail(problem);
}
const productConsumer = join(app, 'product-consumer');
cpSync(PRODUCT_CONSUMER_FIXTURE, productConsumer, { recursive: true });
console.log('Typechecking the one-install product fixture against packed declarations...');
const productTsc = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.consumer.json'], {
  cwd: productConsumer,
  stdio: 'inherit',
});
if (productTsc.status !== 0) {
  fail('the one-install product fixture does not typecheck against packed declarations');
}

// Metro 0.87's own declarations reference four modules kept only in its
// devDependencies. Keep skipLibCheck scoped to that upstream tree, while compiling a
// real call site that proves the installed zmdb wrapper accepts and preserves
// MetroConfig. Every other published subpath remains under the strict check above.
writeFileSync(
  join(app, 'metro-consumer.ts'),
  `import { withZmdb } from '${METRO_SUBPATH}';
import type { MetroConfig } from 'metro';

declare const config: MetroConfig;
export const wrapped: MetroConfig = withZmdb(config, { workerCount: 1 });
`,
);
writeFileSync(
  join(app, 'tsconfig.metro.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        lib: ['ESNext'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['metro-consumer.ts'],
    },
    null,
    2,
  )}\n`,
);
console.log('Typechecking the installed Metro wrapper against MetroConfig...');
const metroTsc = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.metro.json'], {
  cwd: app,
  stdio: 'inherit',
});
if (metroTsc.status !== 0) fail('the published Metro wrapper does not typecheck from a consumer project');

const clientTarball = packedTarballs.get('@zmdb/client');
if (clientTarball === undefined) {
  fail('publish verification produced no @zmdb/client tarball for the generated-client consumer');
} else {
  console.log('Running packed generated clients against the real @zmdb/web fixture...');
  const clientConsumer = run(process.execPath, [HTTP_CLIENT_CONSUMER_FIXTURE, '--client-tarball', clientTarball], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (clientConsumer.status !== 0) fail('the packed generated-client consumers failed');
}

if (errors > 0) {
  console.error(`\nPublish verification failed with ${errors} error(s). Tree kept at ${tmp}`);
  process.exit(1);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n[SUCCESS] ${PACKAGES.length} packages pack, install, import and typecheck from outside the repo.`);
