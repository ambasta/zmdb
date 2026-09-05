// Tests freeze for plugin/SPEC.md §6.
//
// The fixture is bundled by Metro itself. The future package entry is reached through
// `metro.config.js`, exactly as a React Native or Expo application reaches it; there is
// no local transformer stub that could make these tests pass without the public export.

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

import { loadConfig, runBuild } from 'metro';
import { afterAll, describe, expect, it } from 'vitest';

import { codegen } from '../cli/index.js';
import { zmdbAot } from './index.js';

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
  // Measured 2026-09-05: loading the real fixture config fails with
  // ERR_PACKAGE_PATH_NOT_EXPORTED for `@zmdb/aot-validator/metro`.
  it.fails(
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

  // Measured 2026-09-05: the package has no `./metro` export, so the wrapper cannot
  // preserve and invoke the fixture's real `babelTransformerPath`.
  it.fails(
    'delegates to an existing custom transformer',
    async () => {
      const evidence = await configured();
      expect(evidence.code).toContain('__ZMDB_CUSTOM_TRANSFORMER__');
      expect(run(evidence.code).__ZMDB_CUSTOM_TRANSFORMER__).toBe(true);
    },
    BUILD_TIMEOUT,
  );

  // Measured 2026-09-05: there is no exported Metro transformer and therefore no
  // `getCacheKey()` to carry the package version or the project type fingerprint.
  it.fails(
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
    },
    BUILD_TIMEOUT,
  );

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

  // Measured 2026-09-05: `@zmdb/aot-validator/metro` is not exported, so there is
  // no third route whose transformed source can be compared with the two real routes.
  it.fails(
    'emits the same code as the plugin and CLI routes for the same input',
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

  // Measured 2026-09-05: without the `./metro` entry there is no worker-side
  // ReflectSession to count; the fixture stops while loading its config.
  it.fails(
    'opens at most one compiler session per Metro transform process',
    async () => {
      const samples = (await configured()).sessions;
      expect(samples.length).toBeGreaterThan(0);
      expect(new Set(samples.map(sample => sample.pid)).size).toBe(1);
      expect(Math.max(...samples.map(sample => sample.sessions))).toBe(1);
    },
    BUILD_TIMEOUT,
  );

  // Measured 2026-09-05: the missing package entry prevents the no-callee bundle
  // from reaching the worker, so today's observable answer is no Metro integration.
  it.fails(
    'opens no compiler session for a Metro bundle with no transform callees',
    async () => {
      const evidence = await plain();
      expect(evidence.sessions.length).toBeGreaterThan(0);
      expect(evidence.sessions.every(sample => sample.sessions === 0)).toBe(true);
      expect(run(evidence.code).__ZMDB_METRO_PLAIN__).toBe('plain bundle ran');
    },
    BUILD_TIMEOUT,
  );
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
