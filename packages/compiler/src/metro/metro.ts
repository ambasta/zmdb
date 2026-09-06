// Metro's Babel-transformer seam adapted to the same AOT transform used by the
// bundler plugin and code generator.
//
// This entry is loaded through `require()` from CommonJS Metro configuration and
// worker processes. Keep its import graph synchronous: top-level await would make
// `require('@zmdb/compiler/metro')` fail before Metro reads the config.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MetroConfig } from 'metro';
import type { BabelTransformer, BabelTransformerArgs, BabelTransformerCacheKeyOptions } from 'metro-babel-transformer';

const require = createRequire(import.meta.url);
const ENTRY = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(ENTRY), '../..');
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs)$/;
const DELEGATE_FIELD = 'unstable_zmdbDelegatePath';
const PROJECT_FIELD = 'unstable_zmdbProjectPath';
const OPTIONS_FIELD = 'unstable_zmdbOptions';
const ENV_DELEGATE = 'ZMDB_METRO_DELEGATE';
const ENV_MAX_WORKERS = 'ZMDB_METRO_MAX_WORKERS';
const ENV_PROJECT = 'ZMDB_METRO_PROJECT';
const ENV_OPTIONS = 'ZMDB_METRO_OPTIONS';
const VERSION = String(require(join(PACKAGE_ROOT, 'package.json')).version);

// Source exports point at `.ts`, while every authored relative specifier correctly
// names the emitted `.js`. Node's synchronous require of this ESM entry does not
// apply TypeScript's `.js` -> `.ts` source substitution, so install the same narrow
// development-time resolver used by the repository scripts. Published `dist` has
// real `.js` siblings and therefore never takes this branch.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL !== undefined && /^\.{1,2}\/.*\.js$/.test(specifier)) {
      const asJavaScript = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(asJavaScript))) {
        const asTypeScript = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(asTypeScript))) {
          return { url: asTypeScript.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

export interface MetroOptions {
  readonly workerCount?: number;
}

interface TransformHook {
  transform(code: string, id: string): { readonly code: string } | null;
  buildEnd?(): void;
}

interface SessionHandle {
  sourceFileNames(): readonly string[];
  close(): void;
}

interface PluginModule {
  zmdbAot(options: { readonly project: string; readonly cwd: string; readonly session?: SessionHandle }): TransformHook;
}

interface TransformerModule {
  readonly CALLEES: ReadonlySet<string>;
  transformCode(code: string): string;
}

interface SessionModule {
  readonly ReflectSession: {
    open(options: { readonly project: string }): SessionHandle;
  };
}

interface RuntimeConfig {
  readonly delegate: string;
  readonly maxWorkers: number | undefined;
  readonly project: string;
  readonly options: string;
}

interface ActiveHook {
  readonly key: string;
  readonly hook: TransformHook;
  readonly session?: SessionHandle;
}

interface PendingSession {
  readonly key: string;
  readonly projectText: string;
  readonly session: SessionHandle;
}

let activeHook: ActiveHook | undefined;
let pendingSession: PendingSession | undefined;
let calleePattern: RegExp | undefined;

/**
 * Wrap Metro's existing Babel transformer without replacing its worker.
 *
 * The same `metro.config.js` form works for bare React Native and Expo because
 * both have already selected their Babel transformer before this wrapper reads it.
 */
export function withZmdb<Config extends MetroConfig>(config: Config, options: MetroOptions = {}): Config {
  if (options.workerCount !== undefined && (!Number.isInteger(options.workerCount) || options.workerCount < 1)) {
    throw new RangeError('withZmdb workerCount must be a positive integer');
  }

  const projectRoot = resolve(config.projectRoot ?? process.cwd());
  const project = join(projectRoot, 'tsconfig.json');
  if (!existsSync(project)) {
    throw new Error(`withZmdb could not find a TypeScript project at ${project}`);
  }

  const current = config.transformer?.babelTransformerPath ?? 'metro-babel-transformer';
  const previous =
    resolve(current) === resolve(ENTRY)
      ? (readString(config.transformer, DELEGATE_FIELD) ?? process.env[ENV_DELEGATE] ?? 'metro-babel-transformer')
      : current;
  const delegate = require.resolve(previous, { paths: [projectRoot] });
  const workerCount = options.workerCount ?? config.maxWorkers;
  const resolvedOptions = JSON.stringify({
    workerCount: options.workerCount ?? null,
    maxWorkers: workerCount ?? null,
  });

  // With one worker Metro transforms in the config process itself. Loading a new
  // config is therefore the only observable boundary between two programmatic
  // builds, and the previous build's compiler child must not leak across it.
  disposeActiveHook();
  disposePendingSession();

  // Metro 0.87 keeps unknown transformer config in the worker config and cache
  // material but does not pass it to the Babel transformer arguments. Environment
  // variables are inherited by the worker process, so they are the fallback channel
  // frozen by the spec; the serialisable fields remain visible to config tooling.
  process.env[ENV_DELEGATE] = delegate;
  if (workerCount === undefined) delete process.env[ENV_MAX_WORKERS];
  else process.env[ENV_MAX_WORKERS] = String(workerCount);
  process.env[ENV_PROJECT] = project;
  process.env[ENV_OPTIONS] = resolvedOptions;

  const transformer = {
    ...config.transformer,
    babelTransformerPath: ENTRY,
    [DELEGATE_FIELD]: delegate,
    [PROJECT_FIELD]: project,
    [OPTIONS_FIELD]: resolvedOptions,
  };
  return Object.assign({}, config, workerCount === undefined ? {} : { maxWorkers: workerCount }, { transformer });
}

/** Run zmdb first, then hand the rewritten source to the transform Metro already used. */
export function transform(args: BabelTransformerArgs): ReturnType<BabelTransformer['transform']> {
  const config = runtimeConfig();
  const delegate = loadDelegate(config.delegate);
  const fileName = isAbsolute(args.filename) ? args.filename : resolve(args.options.projectRoot, args.filename);
  if (!isProjectSource(fileName, config.project)) return delegate.transform(args);

  const transformer = loadTransformer();
  if (!pattern(transformer.CALLEES).test(args.src)) {
    const code = transformer.transformCode(args.src);
    return delegate.transform(code === args.src ? args : { ...args, src: code });
  }

  const hook = ensureHook(config);
  const transformed = hook.transform(args.src, fileName)?.code ?? args.src;
  return delegate.transform(transformed === args.src ? args : { ...args, src: transformed });
}

/**
 * Return unhashed cache material. Metro folds this into its own digest.
 *
 * A different delegate, zmdb release, wrapper option, tsconfig, or project source
 * stat therefore invalidates every transformed module on the next build.
 */
export function getCacheKey(options?: BabelTransformerCacheKeyOptions): string {
  const config = runtimeConfig(options?.projectRoot);
  const delegate = loadDelegate(config.delegate);
  const delegateKey = delegate.getCacheKey?.(options) ?? '';
  const projectText = readFileSync(config.project, 'utf8');
  return [
    'zmdb-metro',
    VERSION,
    config.delegate,
    delegateKey,
    config.options,
    config.project,
    projectText,
    typeFingerprint(config, projectText),
  ].join('\0');
}

function runtimeConfig(projectRoot?: string): RuntimeConfig {
  const delegate = process.env[ENV_DELEGATE];
  const configuredProject = process.env[ENV_PROJECT];
  if (delegate === undefined) {
    throw new Error('withZmdb must wrap the Metro config before the zmdb transformer is loaded');
  }
  const project = configuredProject ?? join(resolve(projectRoot ?? process.cwd()), 'tsconfig.json');
  const maxWorkersText = process.env[ENV_MAX_WORKERS];
  const maxWorkers = maxWorkersText === undefined ? undefined : Number(maxWorkersText);
  return {
    delegate,
    maxWorkers: maxWorkers !== undefined && Number.isInteger(maxWorkers) && maxWorkers > 0 ? maxWorkers : undefined,
    project,
    options: process.env[ENV_OPTIONS] ?? JSON.stringify({ workerCount: null }),
  };
}

function loadDelegate(path: string): BabelTransformer {
  const loaded = require(path);
  return loaded.__esModule === true && loaded.default !== undefined ? loaded.default : loaded;
}

function loadPlugin(): PluginModule {
  return require('../unplugin/index.js');
}

function loadTransformer(): TransformerModule {
  return require('../transform/index.js');
}

function loadSession(): SessionModule {
  return require('../reflect/session.js');
}

function ensureHook(config: RuntimeConfig): TransformHook {
  const key = `${config.project}\0${config.options}`;
  if (activeHook?.key === key) return activeHook.hook;
  disposeActiveHook();
  const pending = pendingSession?.key === key ? pendingSession : undefined;
  if (pending !== undefined) pendingSession = undefined;
  else disposePendingSession();
  const hook = loadPlugin().zmdbAot(
    pending === undefined
      ? { project: config.project, cwd: dirname(config.project) }
      : { project: config.project, cwd: dirname(config.project), session: pending.session },
  );
  activeHook = pending === undefined ? { key, hook } : { key, hook, session: pending.session };
  return hook;
}

function pattern(callees: ReadonlySet<string>): RegExp {
  calleePattern ??= new RegExp(`\\b(?:${[...callees].join('|')})\\s*(?:<|\\()`);
  return calleePattern;
}

function isProjectSource(fileName: string, project: string): boolean {
  if (fileName.includes(`${sep}node_modules${sep}`) || fileName.endsWith('.d.ts') || !SOURCE.test(fileName)) {
    return false;
  }
  const root = dirname(project);
  const path = relative(root, fileName);
  return path !== '..' && !path.startsWith(`..${sep}`);
}

function typeFingerprint(config: RuntimeConfig, projectText: string): string {
  const key = `${config.project}\0${config.options}`;
  let session: SessionHandle;
  let retained = false;

  if (config.maxWorkers === 1) {
    if (pendingSession?.key !== key || pendingSession.projectText !== projectText) {
      disposePendingSession();
      pendingSession = {
        key,
        projectText,
        session: loadSession().ReflectSession.open({ project: config.project }),
      };
    }
    session = pendingSession.session;
    retained = true;
  } else {
    session = loadSession().ReflectSession.open({ project: config.project });
  }

  const fingerprint = session
    .sourceFileNames()
    .filter(file => !file.includes(`${sep}node_modules${sep}`) && !file.endsWith('.d.ts'))
    .toSorted()
    .map(file => {
      try {
        const stat = statSync(file);
        return `${file}\0${String(stat.size)}\0${String(stat.mtimeMs)}`;
      } catch {
        return `${file}\0missing`;
      }
    })
    .join('\0');
  if (!retained) session.close();
  return fingerprint;
}

function disposeActiveHook(): void {
  activeHook?.hook.buildEnd?.();
  activeHook?.session?.close();
  activeHook = undefined;
}

function disposePendingSession(): void {
  pendingSession?.session.close();
  pendingSession = undefined;
}

function readString(value: object | undefined, key: string): string | undefined {
  if (value === undefined) return undefined;
  const property = Object.getOwnPropertyDescriptor(value, key)?.value;
  return typeof property === 'string' ? property : undefined;
}
