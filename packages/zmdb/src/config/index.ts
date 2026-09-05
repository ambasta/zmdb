import { glob, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { projectSourceFileNames } from '@zmdb/aot-validator/reflect';
import { AssertError } from '@zmdb/aot-validator/utilities';
import { TRAITS, type Dialect } from '@zmdb/query-compiler';
import type { Driver } from '@zmdb/repository';
import { isRecord } from '@zmdb/schema-core';
import { resolveNaming, type NamingStrategy } from '@zmdb/schema-core/naming';

import { zmdbAssertZmdbConfigData } from './index.zmdb.generated.js';

const CONFIG_NAMES = ['zmdb.config.ts', 'zmdb.config.mjs', 'zmdb.config.js'] as const;
const CONFIG_CACHE = new Map<string, Promise<ResolvedConfig>>();

export interface IntrospectOptions {
  readonly schemas?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export type { NamingStrategy } from '@zmdb/schema-core/naming';

/** The plain-data half of a config, validated by the generated AOT checker. */
export interface ZmdbConfigData {
  readonly schema: string | readonly string[];
  readonly dialect: Dialect;
  readonly project?: string;
  readonly out?: string;
  readonly naming?: 'snake_case' | 'snake_case_plural';
  readonly migrations?: {
    readonly table?: string;
    readonly schema?: string;
  };
  readonly introspect?: IntrospectOptions;
}

/** The complete author-facing config, including the two callable boundaries. */
export interface ZmdbConfig extends ZmdbConfigData {
  readonly driver?: () => Driver | Promise<Driver>;
  readonly namingStrategy?: NamingStrategy;
}

/** The concrete paths every command receives after discovery and validation. */
export interface ResolvedConfig extends ZmdbConfig {
  readonly configPath: string;
  readonly project: string;
  readonly out: string;
  readonly schemaFiles: readonly string[];
  readonly outDir: string;
  /** The custom or named strategy, resolved once for every reflection route. */
  readonly resolvedNaming: NamingStrategy;
}

export interface LoadConfigOptions {
  /** Directory discovery starts from. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Explicit config path, resolved against `cwd`; equivalent to `--config`. */
  readonly path?: string;
  /** Return `undefined` when discovery finds no config. An explicit missing path still fails. */
  readonly optional?: boolean;
}

/** Identity helper for inference and editor completion; loading owns validation. */
export function defineConfig<const T extends ZmdbConfig>(config: T): T {
  return config;
}

/**
 * Discover, execute, validate and resolve one config.
 *
 * The cache is process-local and keyed by the selected absolute config path, so
 * separate packages in a monorepo cannot leak resolved paths into one another.
 */
export function loadConfig(
  options: LoadConfigOptions & { readonly optional: true },
): Promise<ResolvedConfig | undefined>;
export function loadConfig(options?: LoadConfigOptions & { readonly optional?: false }): Promise<ResolvedConfig>;
export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig | undefined> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = await discoverConfig(cwd, options.path, options.optional === true);
  if (configPath === undefined) return undefined;
  const cached = CONFIG_CACHE.get(configPath);
  if (cached !== undefined) return cached;

  const pending = loadAndResolve(configPath).catch((error: unknown) => {
    CONFIG_CACHE.delete(configPath);
    throw error;
  });
  CONFIG_CACHE.set(configPath, pending);
  return pending;
}

/**
 * Resolve an already-loaded config against its file.
 *
 * Commands normally call `loadConfig`; this separate boundary lets build tools
 * that already imported the module reuse exactly the same validation and path
 * rules without inventing a second resolver.
 */
export async function resolveConfig(config: ZmdbConfig, configPath: string): Promise<ResolvedConfig> {
  const absolutePath = resolve(configPath);
  return resolveValidatedConfig(validateConfig(config, absolutePath), absolutePath);
}

async function loadAndResolve(configPath: string): Promise<ResolvedConfig> {
  const loaded = await importConfig(configPath);
  const config = validateConfig(loaded, configPath);
  return resolveValidatedConfig(config, configPath);
}

async function discoverConfig(
  cwd: string,
  explicit: string | undefined,
  optional: boolean,
): Promise<string | undefined> {
  if (explicit !== undefined) return resolve(cwd, explicit);

  let directory = cwd;
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(directory, name);
      if (await isFile(candidate)) return candidate;
    }

    if (await isFile(join(directory, 'package.json'))) {
      if (optional) return undefined;
      throw new Error(`No zmdb config found from ${cwd}; discovery stopped at package boundary ${directory}`);
    }

    const parent = dirname(directory);
    if (parent === directory) {
      if (optional) return undefined;
      throw new Error(`No zmdb config found from ${cwd}; discovery reached filesystem root ${directory}`);
    }
    directory = parent;
  }
}

async function importConfig(configPath: string): Promise<unknown> {
  try {
    const namespace = Object.fromEntries(Object.entries(await import(pathToFileURL(configPath).href)));
    const names = Object.keys(namespace);
    const hasDefault = Object.hasOwn(namespace, 'default');
    const hasNamed = Object.hasOwn(namespace, 'config');

    if (names.length !== 1 || hasDefault === hasNamed) {
      const found = names.length === 0 ? 'no exports' : names.join(', ');
      throw new Error(`expected exactly one default export or named \`config\` export; found ${found}`);
    }

    return await Promise.resolve(hasDefault ? namespace.default : namespace.config);
  } catch (error: unknown) {
    const hint =
      errorCode(error) === 'ERR_MODULE_NOT_FOUND'
        ? ' Node does not remap a .js import specifier to a .ts source; name the real file or provide a Node loader hook.'
        : '';
    throw new Error(`Failed to load ${configPath}: ${errorMessages(error).join(': ')}.${hint}`, { cause: error });
  }
}

function validateConfig(input: unknown, configPath: string): ZmdbConfig {
  if (!isRecord(input)) {
    throw new Error(`Invalid config ${configPath}: expected an object`, { cause: input });
  }

  const { driver, namingStrategy, ...dataInput } = input;
  let data: ZmdbConfigData;
  try {
    data = zmdbAssertZmdbConfigData(dataInput);
  } catch (error: unknown) {
    if (error instanceof AssertError) {
      const issue = error.issues[0];
      const field = issue?.path.replace(/^input\.?/, '') || 'config';
      throw new Error(`Invalid config ${configPath}: ${field} ${issue?.message ?? error.message}`, { cause: error });
    }
    throw new Error(`Invalid config ${configPath}: ${errorMessages(error).join(': ')}`, { cause: error });
  }

  if (driver !== undefined && !isDriverFactory(driver)) {
    throw new Error(`Invalid config ${configPath}: driver must be a function`);
  }
  if (namingStrategy !== undefined && !isNamingStrategy(namingStrategy)) {
    throw new Error(
      `Invalid config ${configPath}: namingStrategy must be an object whose column, table and index members are functions`,
    );
  }

  return {
    ...data,
    ...(driver === undefined ? {} : { driver }),
    ...(namingStrategy === undefined ? {} : { namingStrategy }),
  };
}

async function resolveValidatedConfig(config: ZmdbConfig, configPath: string): Promise<ResolvedConfig> {
  const directory = dirname(configPath);
  const project = resolve(directory, config.project ?? 'tsconfig.json');
  const outDir = resolve(directory, config.out ?? 'migrations');
  const resolvedNaming = resolveNaming(config.namingStrategy ?? config.naming);

  if (config.migrations?.schema !== undefined && TRAITS[config.dialect].family !== 'postgres') {
    throw new Error(
      `Invalid config ${configPath}: migrations.schema is PostgreSQL-only and cannot be used with ${config.dialect}`,
    );
  }

  let projectFiles: readonly string[];
  try {
    projectFiles = projectSourceFileNames(project);
  } catch (error: unknown) {
    throw new Error(
      `Failed to read TypeScript project ${project} for ${configPath}: ${errorMessages(error).join(': ')}`,
      {
        cause: error,
      },
    );
  }

  const schemaFiles = await expandSchemaFiles(config.schema, directory, project, projectFiles, configPath);
  return {
    ...config,
    project,
    out: outDir,
    configPath,
    schemaFiles,
    outDir,
    resolvedNaming,
  };
}

async function expandSchemaFiles(
  configured: string | readonly string[],
  directory: string,
  project: string,
  projectFiles: readonly string[],
  configPath: string,
): Promise<readonly string[]> {
  const patterns = typeof configured === 'string' ? [configured] : configured;
  if (patterns.length === 0) throw new Error(`Invalid config ${configPath}: schema must contain at least one glob`);

  const included = new Set(projectFiles.map(pathKey));
  const selected = new Set<string>();

  for (const pattern of patterns) {
    if (pattern.length === 0) throw new Error(`Invalid config ${configPath}: schema contains an empty glob`);
    const matches: string[] = [];
    try {
      for await (const match of glob(pattern, { cwd: directory })) {
        const absolute = resolveGlobMatch(match, directory);
        if (await isFile(absolute)) matches.push(absolute);
      }
    } catch (error: unknown) {
      throw new Error(
        `Invalid schema glob ${JSON.stringify(pattern)} in ${configPath}: ${errorMessages(error).join(': ')}`,
        {
          cause: error,
        },
      );
    }

    if (matches.length === 0) {
      throw new Error(`Schema glob ${JSON.stringify(pattern)} in ${configPath} matched no files`);
    }

    for (const file of matches) {
      if (!included.has(pathKey(file))) {
        throw new Error(`Schema file ${file} matched ${JSON.stringify(pattern)} but is not included by ${project}`);
      }
      selected.add(file);
    }
  }

  return [...selected].toSorted();
}

function resolveGlobMatch(match: string, directory: string): string {
  return normalize(isAbsolute(match) ? match : resolve(directory, match));
}

function pathKey(path: string): string {
  const normalized = normalize(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function isDriverFactory(value: unknown): value is NonNullable<ZmdbConfig['driver']> {
  return typeof value === 'function';
}

function isNamingStrategy(value: unknown): value is NamingStrategy {
  if (!isRecord(value)) return false;
  for (const key of ['column', 'table', 'index'] as const) {
    const member = value[key];
    if (member !== undefined && typeof member !== 'function') return false;
  }
  return true;
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function errorMessages(error: unknown, seen = new Set<unknown>()): readonly string[] {
  if (seen.has(error)) return [];
  seen.add(error);

  if (error instanceof Error) {
    const nested = error.cause === undefined ? [] : errorMessages(error.cause, seen);
    return [error.message, ...nested];
  }
  return [String(error)];
}
