#!/usr/bin/env node
// The publish smoke test: pack what would be published, install it into a throwaway
// project, and then both *load* and *typecheck* every subpath from outside the repo.
//
// `verify:exports` cannot do this job, and for a while it looked like it could. It
// imports every subpath under plain `node` — but it does so from the workspace root,
// where `node_modules/@zmdb/schema` is a symlink into `packages/`. Node resolves
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
//   * executable — the installed `@zmdb/cli` bin starts Studio on loopback and serves a
//     declared table, catching lazy syntax that importing `@zmdb/cli` never reaches.
//
// Plus one thing neither surface reports: a `.d.ts` whose relative specifiers still end
// in `.ts`. `tsc` substitutes the extension and resolves it anyway, which is why this is
// asserted directly instead of being left to the typecheck to notice.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { qualifyRuntimeFoundation } from '../../fixtures/consumer-runtime-foundation/verify-installed.mjs';
import { qualifySelectedJobs } from '../../fixtures/consumer-selected-jobs/qualify.mjs';
import { inspectServerCoreFixture } from '../../fixtures/consumer-server-core/verify-installed.mjs';
import { ROOT, publishCatalog, publishManifest, readManifest } from './lib/publish-manifest.mjs';

const CUSTOM_TRANSPORT_FIXTURE = join(ROOT, 'fixtures', 'app-custom-transport.ts');
const PRODUCT_CONSUMER_FIXTURE = join(ROOT, 'fixtures', 'consumer-product');
const SERVER_CORE_CONSUMER_FIXTURE = join(ROOT, 'fixtures', 'consumer-server-core');
const HTTP_CLIENT_CONSUMER_FIXTURE = join(ROOT, 'fixtures', 'consumer-http-client', 'verify-installed.mjs');
const PUBLISH_PACKAGES = await publishCatalog(ROOT);
const publishedNames = new Set(PUBLISH_PACKAGES.map(entry => entry.npmName));
const PEERS = [
  ...new Set([
    ...PUBLISH_PACKAGES.flatMap(entry => Object.keys(entry.manifest.peerDependencies ?? {})),
    '@types/node',
    '@types/pg',
    '@types/react',
    'server-only',
  ]),
]
  .filter(name => !publishedNames.has(name))
  .toSorted();

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

function verifyServerCoreConsumer(app) {
  for (const problem of inspectServerCoreFixture(SERVER_CORE_CONSUMER_FIXTURE)) {
    fail(problem);
  }

  const consumer = join(app, 'server-core-consumer');
  cpSync(SERVER_CORE_CONSUMER_FIXTURE, consumer, { recursive: true });

  console.log('Typechecking every app, HTTP, jobs, and facade subpath against packed declarations...');
  const typecheck = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.consumer.json'], {
    cwd: consumer,
    stdio: 'inherit',
  });
  if (typecheck.status !== 0) {
    fail('the packed core-server declarations do not typecheck from the installed consumer');
    return;
  }

  console.log('Checking packed app, HTTP, jobs, and facade runtime identity...');
  const identity = run(process.execPath, ['src/runtime.mjs'], { cwd: consumer, stdio: 'inherit' });
  if (identity.status !== 0) {
    fail('the packed core-server facade does not preserve runtime identity');
    return;
  }

  console.log('Executing the packed HTTP, command, and in-memory job journey...');
  const compiled = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.runtime.json'], {
    cwd: consumer,
    stdio: 'inherit',
  });
  if (compiled.status !== 0) {
    fail('the packed cohesive server journey does not compile');
    return;
  }
  const journey = run(process.execPath, ['dist/journey.js'], { cwd: consumer, stdio: 'inherit' });
  if (journey.status !== 0) {
    fail('the packed cohesive server journey does not execute');
  }
}

async function smokeStudio(app, binPath) {
  const configPath = join(app, 'zmdb.config.mjs');
  writeFileSync(
    configPath,
    `import { sqlite } from 'zmdb/sqlite';

export default {
  schema: './schema.ts',
  dialect: sqlite,
  project: './tsconfig.json',
  driver: () => ({
    dialect: sqlite,
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
const { sqlite } = await import('zmdb/sqlite');
const authored = {
  schema: './schema.ts',
  dialect: sqlite,
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
for (const packageRecord of PUBLISH_PACKAGES) {
  const pkg = publishManifest(readManifest(packageRecord.id, PUBLISH_PACKAGES));
  const src = join(ROOT, packageRecord.directory);
  const dst = join(stage, packageRecord.id);

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
  if (pkg.bin) {
    const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin;
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
      if (pkg.name === '@zmdb/cli' && command === 'zmdb') studioBin = binPath;
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

const foundationReport = await qualifyRuntimeFoundation({
  tarballs: PUBLISH_PACKAGES.flatMap(packageRecord => {
    const manifest = publishManifest(readManifest(packageRecord.id, PUBLISH_PACKAGES));
    const tarball = packedTarballs.get(manifest.name);
    return tarball === undefined ? [] : [{ manifest, tarball }];
  }),
  evidence: join(tmp, 'runtime-foundation-evidence'),
});
if (
  foundationReport.cleaned !== true ||
  foundationReport.failures.length !== 0 ||
  foundationReport.consumers
    .map(consumer => consumer.lane)
    .toSorted()
    .join(',') !== 'application,generated,orm,schema,sql,validator'
) {
  fail(`Runtime foundation qualification failed: ${JSON.stringify(foundationReport.failures)}`);
}
console.log('Runtime foundation qualification evidence:', JSON.stringify(foundationReport));

const selectedJobsReport = await qualifySelectedJobs({
  tarballs: PUBLISH_PACKAGES.flatMap(packageRecord => {
    const manifest = publishManifest(readManifest(packageRecord.id, PUBLISH_PACKAGES));
    const tarball = packedTarballs.get(manifest.name);
    return tarball === undefined ? [] : [{ manifest, tarball }];
  }),
});
if (
  !selectedJobsReport.cleaned ||
  selectedJobsReport.failures.length > 0 ||
  JSON.stringify(selectedJobsReport.consumers.map(consumer => consumer.lane).toSorted()) !==
    JSON.stringify(['default', 'postgres', 'sqlite'])
) {
  fail(`Selected jobs qualification failed: ${selectedJobsReport.failures.join('\n')}`);
}
console.log('Selected jobs qualification evidence:', JSON.stringify(selectedJobsReport));

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

// 4. Parse and execute the installed Studio path. Importing `@zmdb/cli` is not
// enough: ESNext emit can preserve decorator syntax that plain Node rejects only
// when the lazy Studio module is loaded.
const studioDirectory = join(app, 'node_modules', '@zmdb', 'cli', 'dist', 'studio');
for (const file of javascript(studioDirectory)) {
  const checked = run('node', ['--check', file]);
  if (checked.status !== 0) {
    fail(`plain Node cannot parse ${file.slice(app.length + 1)}: ${checked.stderr?.trim()}`);
  }
}
if (studioBin === undefined) {
  fail('the installed @zmdb/cli package did not expose its canonical bin');
} else {
  try {
    await smokeStudio(app, studioBin);
    console.log('  executed installed zmdb Studio bin and fetched its loopback index');
  } catch (error) {
    fail(`installed "zmdb studio --port 0" smoke failed: ${messageOf(error)}`);
  }
}

// 5. Typecheck a consumer against the published declarations.
const METRO_SUBPATH = '@zmdb/compiler/metro';
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
import { sqlite } from 'zmdb/sqlite';

const http = {
  contracts: './src/http.contract.ts#HTTP_CONTRACT',
  openApi: { out: './generated/openapi.json' },
  client: { out: './generated/http-client.generated.ts' },
} satisfies HttpGenerationConfig;

export const config = defineConfig({
  schema: './src/schema.ts',
  dialect: sqlite,
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

// The cohesive server fixture imports and typechecks every direct app/web/jobs
// package entry and its stable zmdb facade counterpart from this packed tree.
// Its emitted journey then serves HTTP, runs a command and consumes one job
// through the explicitly selected SQLite memory provider.
verifyServerCoreConsumer(app);

// Compile the product consumer against the actual packed declarations.
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
  `import { withZmdb as withOwnerZmdb } from '${METRO_SUBPATH}';
import type { MetroConfig } from 'metro';

declare const config: MetroConfig;
export const ownerWrapped: MetroConfig = withOwnerZmdb(config, { workerCount: 1 });
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

console.log('Running the four installed tooling-owner consumers...');
const toolingConsumer = run(
  process.execPath,
  [
    join(ROOT, 'fixtures/consumer-tooling-cutover/verify-installed.mjs'),
    '--root',
    ROOT,
    '--evidence-dir',
    join(tmp, 'tooling-owner-consumer'),
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
if (toolingConsumer.status !== 0) fail('the packed tooling-owner consumers failed');

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
console.log(
  `\n[SUCCESS] ${String(PUBLISH_PACKAGES.length)} packages pack, install, import and typecheck from outside the repo.`,
);
