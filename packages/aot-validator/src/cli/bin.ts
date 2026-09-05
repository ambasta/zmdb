#!/usr/bin/env node
// The `zmdb-codegen` executable. Argument parsing and exit codes; the work is in `./index.ts`.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { NamingStrategy } from '@zmdb/schema-core/naming';

import { codegen, watchCodegen } from './index.js';

const USAGE = `zmdb-codegen — compile zmdb's validators ahead of time, without a bundler.

  zmdb-codegen [--config <zmdb.config.ts>] [--project <tsconfig.json>] [--check] [--watch]

  --config <path>   use this zmdb config instead of discovery
  --project <path>  override the config's project. Default without a config: ./tsconfig.json
  --check           write nothing; exit 1 if anything on disk is out of date
  --watch           regenerate on every save, on one compiler session

For each source file that calls is/isShallow/equals/assert/assertShallow/assertEquals/
validate/validateShallow/random/toJsonSchema/schemaOf/toolFor/protoDescriptor/
protoDecode/protoEncode/grpcDescriptor/loadGrpcService with a type argument, this
writes three files beside it — a witness the compiler checks, the compiled JavaScript,
and its declarations — and rewrites the call to use them.
Commit all four: the point is that a fresh clone builds the fast path with no tool involved.
`;

interface LoadedBuildConfig {
  readonly project: string;
  readonly resolvedNaming: NamingStrategy;
}

interface ConfigModule {
  loadConfig(options: {
    readonly cwd: string;
    readonly path?: string;
    readonly optional?: boolean;
  }): Promise<LoadedBuildConfig | undefined>;
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  const configAt = argv.indexOf('--config');
  const configPath = configAt === -1 ? undefined : argv[configAt + 1];
  if (configAt !== -1 && configPath === undefined) {
    process.stderr.write('zmdb-codegen: --config needs a path\n');
    return 2;
  }

  const at = argv.indexOf('--project');
  const named = at === -1 ? undefined : argv[at + 1];
  if (at !== -1 && named === undefined) {
    process.stderr.write('zmdb-codegen: --project needs a path\n');
    return 2;
  }

  const cwd = process.cwd();
  const projectOverride = named === undefined ? undefined : resolve(cwd, named);
  let configured: LoadedBuildConfig | undefined;
  try {
    configured = await loadProjectConfig(cwd, configPath, projectOverride);
  } catch (error: unknown) {
    process.stderr.write(`zmdb-codegen: ${errorMessage(error)}\n`);
    return 2;
  }

  const project = projectOverride ?? configured?.project ?? join(cwd, 'tsconfig.json');
  if (!existsSync(project)) {
    process.stderr.write(`zmdb-codegen: no project at ${project}\n`);
    return 2;
  }

  const check = argv.includes('--check');
  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  if (argv.includes('--watch')) {
    if (check) {
      process.stderr.write('zmdb-codegen: --check and --watch ask for opposite things\n');
      return 2;
    }
    await watchCodegen({
      project,
      ...(configured === undefined ? {} : { naming: configured.resolvedNaming }),
      log,
    });
    return 0;
  }

  const result = codegen({
    project,
    ...(configured === undefined ? {} : { naming: configured.resolvedNaming }),
    check,
    log,
  });
  for (const problem of result.problems) process.stderr.write(`error: ${problem}\n`);
  if (result.problems.length > 0) return 1;
  if (check && !result.ok) {
    // Not an error in the code — an error in the tree. The distinction matters to whoever
    // reads the CI log, so it gets its own sentence rather than a bare exit code.
    process.stderr.write(
      `zmdb-codegen: ${String(result.written.length + result.deleted.length)} generated file(s) are out of date. Run \`zmdb-codegen\` and commit the result.\n`,
    );
    return 1;
  }
  return 0;
}

/**
 * Load the umbrella package's config from the consumer project when it is installed.
 *
 * `@zmdb/aot-validator` remains usable on its own, so it cannot depend statically on
 * `zmdb`, which already depends on this package. Resolving from the consumer's cwd keeps
 * that integration optional and avoids a package cycle while still making the installed
 * `zmdb-codegen` binary config-aware.
 */
async function loadProjectConfig(
  cwd: string,
  path: string | undefined,
  project: string | undefined,
): Promise<LoadedBuildConfig | undefined> {
  const configCwd = path === undefined && project !== undefined ? dirname(project) : cwd;
  const configModule = await importConfigModule(configCwd);
  if (configModule === undefined) {
    if (path !== undefined) {
      throw new Error('cannot use --config because this project does not install the zmdb umbrella package');
    }
    return undefined;
  }
  return configModule.loadConfig({
    cwd: configCwd,
    ...(path === undefined ? { optional: true } : { path }),
  });
}

async function importConfigModule(cwd: string): Promise<ConfigModule | undefined> {
  const require = createRequire(join(cwd, 'package.json'));
  let entry: string;
  try {
    entry = require.resolve('zmdb/config');
  } catch (error: unknown) {
    if (errorCode(error) === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }

  const loaded: unknown = await import(pathToFileURL(entry).href);
  if (!isConfigModule(loaded)) throw new TypeError('zmdb/config does not export a loadConfig function');
  return loaded;
}

function isConfigModule(value: unknown): value is ConfigModule {
  return typeof value === 'object' && value !== null && 'loadConfig' in value && typeof value.loadConfig === 'function';
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

process.exit(await main(process.argv.slice(2)));
