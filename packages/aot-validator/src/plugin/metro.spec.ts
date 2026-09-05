// Tests freeze for plugin/SPEC.md §6.
//
// The fixture is bundled by Metro itself. The future package entry is reached through
// `metro.config.js`, exactly as a React Native or Expo application reaches it; there is
// no local transformer stub that could make these tests pass without the public export.

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

import { loadConfig, runBuild, type MetroConfig } from 'metro';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { codegen } from '../cli/index.js';
import { zmdbAot } from './index.js';
import { withZmdb } from './metro.js';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const FIXTURE = join(ROOT, 'fixtures', 'consumer-metro');
const ENTRY = join(FIXTURE, 'src', 'index.ts');
const MODEL = join(FIXTURE, 'src', 'model.ts');
const SCRATCH = mkdtempSync(join(tmpdir(), 'zmdb-metro-freeze-'));
const BUILD_TIMEOUT = 180_000;
const require = createRequire(import.meta.url);

interface SessionSample {
  readonly file: string;
  readonly pid: number;
  readonly sessions: number;
}

interface BundleEvidence {
  readonly code: string;
  readonly transformed: string;
  readonly sessions: readonly SessionSample[];
}

let configuredPromise: Promise<BundleEvidence> | undefined;
let plainPromise: Promise<BundleEvidence> | undefined;

beforeAll(async () => {
  // Metro runs in this process when maxWorkers is one, while apiInstanceCount()
  // deliberately counts every compiler child ever opened. Measure the no-callee
  // process before the configured build opens its one lazy session.
  plainPromise = capturedBundle('src/plain.ts', 'plain');
  await plainPromise;
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

async function config(name: string) {
  return loadConfig({ config: join(FIXTURE, name), cwd: FIXTURE });
}

async function bundle(configName: string, entry: string): Promise<string> {
  const loaded = await config(configName);
  return (
    await runBuild(loaded, {
      entry,
      dev: false,
      minify: false,
      platform: 'ios',
    })
  ).code;
}

async function capturedBundle(entry: string, label: string): Promise<BundleEvidence> {
  const capture = join(SCRATCH, `${label}.transformed.ts`);
  const sessions = join(SCRATCH, `${label}.sessions.jsonl`);
  const previousCapture = process.env.ZMDB_METRO_CAPTURE;
  const previousSessions = process.env.ZMDB_METRO_SESSIONS;
  process.env.ZMDB_METRO_CAPTURE = capture;
  process.env.ZMDB_METRO_SESSIONS = sessions;
  try {
    const code = await bundle('metro.config.js', entry);
    return {
      code,
      transformed: entry.endsWith('/index.ts') ? readFileSync(capture, 'utf8') : '',
      sessions: readFileSync(sessions, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as SessionSample),
    };
  } finally {
    if (previousCapture === undefined) delete process.env.ZMDB_METRO_CAPTURE;
    else process.env.ZMDB_METRO_CAPTURE = previousCapture;
    if (previousSessions === undefined) delete process.env.ZMDB_METRO_SESSIONS;
    else process.env.ZMDB_METRO_SESSIONS = previousSessions;
  }
}

function configured(): Promise<BundleEvidence> {
  configuredPromise ??= capturedBundle('src/index.ts', 'configured');
  return configuredPromise;
}

function plain(): Promise<BundleEvidence> {
  plainPromise ??= capturedBundle('src/plain.ts', 'plain');
  return plainPromise;
}

function run(code: string): Record<string, unknown> {
  const context: Record<string, unknown> = { console };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

describe('the Metro build path', () => {
  it(
    'bundles a fixture app with Metro and inlines the schema',
    async () => {
      const evidence = await configured();
      expect(evidence.transformed).toContain('const _zmdbSchema');
      expect(evidence.transformed).not.toMatch(/\bschemaOf<User>\s*\(/);
      expect(run(evidence.code).__ZMDB_METRO_RESULT__).toEqual({
        acceptsGood: true,
        acceptsBad: false,
        table: 'users',
      });
    },
    BUILD_TIMEOUT,
  );

  it(
    'delegates to an existing custom transformer',
    async () => {
      const evidence = await configured();
      expect(evidence.code).toContain('__ZMDB_CUSTOM_TRANSFORMER__');
      expect(run(evidence.code).__ZMDB_CUSTOM_TRANSFORMER__).toBe(true);
    },
    BUILD_TIMEOUT,
  );

  it(
    'invalidates the Metro cache when the transform version changes',
    async () => {
      const loaded = await config('metro.config.js');
      const transformerPath = loaded.transformer.babelTransformerPath;
      const transformer = require(transformerPath) as {
        getCacheKey(options: { readonly projectRoot: string }): string;
      };
      const version = (require(join(ROOT, 'packages', 'aot-validator', 'package.json')) as { version: string }).version;
      const first = transformer.getCacheKey({ projectRoot: FIXTURE });
      expect(transformer.getCacheKey({ projectRoot: FIXTURE })).toBe(first);
      expect(first).toContain(version);

      const original = statSync(MODEL);
      const changed = new Date(Math.max(Date.now() + 2_000, original.mtimeMs + 2_000));
      try {
        utimesSync(MODEL, original.atime, changed);
        expect(transformer.getCacheKey({ projectRoot: FIXTURE })).not.toBe(first);
      } finally {
        utimesSync(MODEL, original.atime, original.mtime);
      }

      const project = join(FIXTURE, 'tsconfig.json');
      const tsconfig = readFileSync(project, 'utf8');
      try {
        writeFileSync(project, `${tsconfig}\n`);
        expect(transformer.getCacheKey({ projectRoot: FIXTURE })).not.toBe(first);
      } finally {
        writeFileSync(project, tsconfig);
      }
    },
    BUILD_TIMEOUT,
  );

  it('preserves an Expo-style Metro config while wrapping its Babel transformer', () => {
    const expo = {
      projectRoot: FIXTURE,
      maxWorkers: 8,
      transformerPath: '/expo/metro-transform-worker.js',
      transformer: {
        babelTransformerPath: require.resolve(join(FIXTURE, 'custom-transformer.js')),
      },
    } satisfies MetroConfig;

    const wrapped = withZmdb(expo, { workerCount: 2 });

    expect(wrapped.transformerPath).toBe(expo.transformerPath);
    expect(wrapped.maxWorkers).toBe(2);
    expect(wrapped.transformer.babelTransformerPath).not.toBe(expo.transformer.babelTransformerPath);
  });

  it(
    'still throws the untransformed-build error in an unconfigured bundle',
    async () => {
      // Measured 2026-09-05 against Metro 0.87.0: the real bundle contains the
      // `schemaOf` fallback and throws this sentence when its entry module runs.
      const code = await bundle('metro.unconfigured.config.js', 'src/index.ts');
      expect(() => run(code)).toThrow(
        'schemaOf<T>() was not replaced at build time. It is compiled away by the zmdb transform',
      );
    },
    BUILD_TIMEOUT,
  );

  it(
    'transforms one consumer through direct codegen and the unplugin with byte-equivalent generated behavior',
    async () => {
      const evidence = await configured();
      const source = readFileSync(ENTRY, 'utf8');
      const hook = zmdbAot({ project: join(FIXTURE, 'tsconfig.json'), cwd: FIXTURE });
      let pluginCode: string | undefined;
      try {
        pluginCode = hook.transform(source, ENTRY)?.code;
      } finally {
        hook.buildEnd?.();
      }
      expect(pluginCode).toBeDefined();
      expect(evidence.transformed).toBe(pluginCode);

      const cli = mkdtempSync(join(FIXTURE, '.cli-route-'));
      try {
        mkdirSync(join(cli, 'src'));
        cpSync(join(FIXTURE, 'tsconfig.json'), join(cli, 'tsconfig.json'));
        cpSync(MODEL, join(cli, 'src', 'model.ts'));
        cpSync(ENTRY, join(cli, 'src', 'index.ts'));
        const result = codegen({ project: join(cli, 'tsconfig.json') });
        expect(result.problems).toEqual([]);
        expect(result.ok).toBe(true);
        const generated = readFileSync(join(cli, 'src', 'index.zmdb.generated.js'), 'utf8');
        expect(checkBody(generated)).toBe(checkBody(evidence.transformed));
      } finally {
        rmSync(cli, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT,
  );

  it(
    'opens at most one compiler session per Metro transform process',
    async () => {
      const samples = (await configured()).sessions;
      expect(samples.length).toBeGreaterThan(0);
      expect(new Set(samples.map(sample => sample.pid)).size).toBe(1);
      expect(Math.max(...samples.map(sample => sample.sessions))).toBe(1);
    },
    BUILD_TIMEOUT,
  );

  it(
    'opens no compiler session for a Metro bundle with no transform callees',
    async () => {
      const evidence = await plain();
      expect(evidence.sessions.length).toBeGreaterThan(0);
      expect(evidence.sessions.every(sample => sample.sessions === 0)).toBe(true);
      expect(run(evidence.code).__ZMDB_METRO_PLAIN__).toBe('plain bundle ran');
    },
    BUILD_TIMEOUT,
  );

  it('reuses the cache-key compiler session when Metro transforms in the config process', () => {
    const wrappedConfig = withZmdb(
      {
        projectRoot: FIXTURE,
        maxWorkers: 1,
        transformer: {
          babelTransformerPath: require.resolve(join(FIXTURE, 'custom-transformer.js')),
        },
      },
      { workerCount: 1 },
    );
    const transformer = require(wrappedConfig.transformer.babelTransformerPath);
    const session = require(join(ROOT, 'packages/aot-validator/src/reflect/session.ts'));
    const before = session.apiInstanceCount();

    transformer.getCacheKey({ projectRoot: FIXTURE });
    transformer.transform({
      filename: 'src/index.ts',
      src: readFileSync(ENTRY, 'utf8'),
      options: {
        dev: false,
        enableBabelRCLookup: true,
        enableBabelRuntime: false,
        experimentalImportSupport: true,
        hermesParser: false,
        minify: false,
        platform: 'ios',
        projectRoot: FIXTURE,
        publicPath: '/assets',
        globalPrefix: '',
      },
      plugins: [],
    });

    expect(session.apiInstanceCount() - before).toBe(1);
  });
});

function checkBody(code: string): string {
  const name = /_zmdbCheckUser\d+/.exec(code)?.[0];
  if (name === undefined) throw new Error('generated code has no User predicate');
  return functionBody(code, name)
    .replaceAll(/(_zmdb[A-Za-z]+)\d+/g, '$1')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function functionBody(code: string, name: string): string {
  const at = code.indexOf(`function ${name}(`);
  if (at === -1) throw new Error(`no \`${name}\` in the generated code`);
  const open = code.indexOf('{', at);
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    else if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, index);
    }
  }
  throw new Error(`\`${name}\` is not closed`);
}
