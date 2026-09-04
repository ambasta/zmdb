// zmdb/cli — argument handling for developer and schema commands.
//
// The executable is a build-time boundary: config loading, TypeScript
// reflection, esbuild and node:repl must not enter an application bundle.

import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describeGraph, renderDot, renderTree, type GraphFilter } from '@zmdb/web/devtools';
import type { ModuleClass } from '@zmdb/web/modules';

import { commandHelp, globalHelp, parseCommand, type ParsedCommand } from './args.js';
import { exportSchema, type ExportResult } from './commands/export.js';
import { generateMigration, type GenerateOptions, type GenerateResult } from './commands/generate.js';
import { loadConfig, resolveConfig, type ResolvedConfig, type ZmdbConfig } from './config.js';
import { CliOutput, type CliResult } from './output.js';
import { createReplSession, replHistoryPath } from './repl.js';

export { exportSchema, generateMigration };
export type { CliResult, ExportResult, GenerateOptions, GenerateResult };

export interface CliEnvironment {
  readonly cwd?: string;
  readonly stdinIsTTY?: boolean;
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
}

interface RuntimeEnvironment {
  readonly cwd: string;
  readonly stdinIsTTY: boolean;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
}

interface ModulesOptions {
  readonly moduleSpec: string;
  readonly format: 'tree' | 'dot';
  readonly formatWasNamed: boolean;
  readonly filter: GraphFilter;
}

interface ReplOptions {
  readonly moduleSpec: string;
  readonly history: boolean;
}

const DEFAULT_MODULE_SPEC = './src/app.module.ts#AppModule';
const PACKAGE_VERSION = readPackageVersion();

let applicationLoader: Promise<void> | undefined;

/** Run the CLI against injectable streams, returning its process exit code. */
export async function runCli(argv: readonly string[], environment: CliEnvironment = {}): Promise<number> {
  const io = runtimeEnvironment(environment);
  const command = argv[0];
  const globalConfig = resolve(io.cwd, 'zmdb.config.ts');

  if (command === '--help' || command === '-h') {
    return new CliOutput('help', globalConfig, argv.includes('--json'), io).help(globalHelp());
  }
  if (command === '--version') {
    return new CliOutput('version', globalConfig, argv.includes('--json'), io).result(
      { version: PACKAGE_VERSION },
      `zmdb ${PACKAGE_VERSION}\n`,
    );
  }
  if (command === undefined) {
    new CliOutput('zmdb', globalConfig, false, io).writeStderr(globalHelp());
    return 2;
  }
  if (command === 'graph') {
    new CliOutput('graph', globalConfig, false, io).writeStderr(
      'zmdb: "graph" is ambiguous in a schema tool; use "zmdb modules"\n',
    );
    return 2;
  }

  const parsedResult = parseCommand(command, argv.slice(1), io.cwd);
  if ('error' in parsedResult) {
    return new CliOutput(command, parsedResult.config, parsedResult.json, io).failure(parsedResult.error, 2);
  }

  const parsed = parsedResult.parsed;
  const output = new CliOutput(command, parsed.config, parsed.json, io);
  if (parsed.help) return output.help(commandHelp(command));
  if (parsed.version) {
    return output.result({ version: PACKAGE_VERSION }, `zmdb ${PACKAGE_VERSION}\n`);
  }
  if (command === 'up') {
    return output.failure(
      '`up` is not a command; use `migrate` to apply migrations or `upgrade` to rewrite a stored snapshot',
      2,
    );
  }
  if (command === 'new') {
    const { createNewScaffold } = await import('./commands/new.js');
    return createNewScaffold(parsed, output, io.cwd);
  }
  if (command === 'modules') return runModules(parsed, io);
  if (command === 'repl') return runRepl(parsed, io);
  return runDatabaseCommand(parsed, io);
}

async function runDatabaseCommand(parsed: ParsedCommand, io: RuntimeEnvironment): Promise<number> {
  const pendingOutput = new CliOutput(parsed.command, parsed.config, parsed.json, io);
  let config: ResolvedConfig;
  try {
    config = await loadCommandConfig(parsed, io.cwd);
  } catch (error) {
    return pendingOutput.failure(errorMessage(error), 2, parsed.config);
  }

  const output = pendingOutput.withConfig(config.configPath);
  try {
    if (parsed.command === 'generate') {
      const name = typeof parsed.values.name === 'string' ? parsed.values.name : undefined;
      if (name !== undefined && !/[a-z0-9]/i.test(name)) {
        return output.failure(`migration name ${JSON.stringify(name)} has no letters or digits`, 2);
      }
      const result = await generateMigration(config, name === undefined ? {} : { name });
      const human =
        'file' in result
          ? `${config.configPath}\nwrote ${result.file} (${String(result.ops.length)} operations)\n`
          : `${config.configPath}\nno changes; no migration written\n`;
      return output.result(result, human);
    }
    if (parsed.command === 'export') {
      const result = exportSchema(config);
      const sql = result.statements.length === 0 ? '' : `${result.statements.join(';\n')};\n`;
      return output.result(result, `-- zmdb config: ${config.configPath}\n${sql}`);
    }
    return output.failure(`command "${parsed.command}" is not implemented yet`, 2);
  } catch (error) {
    return output.failure(errorMessage(error), 1);
  }
}

async function loadCommandConfig(parsed: ParsedCommand, cwd: string): Promise<ResolvedConfig> {
  const explicit = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const loaded = await loadConfig({
    cwd,
    ...(explicit === undefined ? {} : { path: explicit }),
  });
  if (parsed.project === undefined) return loaded;
  return resolveConfig(authorConfig(loaded, resolve(cwd, parsed.project)), loaded.configPath);
}

function authorConfig(config: ResolvedConfig, project: string): ZmdbConfig {
  return {
    schema: config.schema,
    dialect: config.dialect,
    project,
    out: config.out,
    ...(config.naming === undefined ? {} : { naming: config.naming }),
    ...(config.migrations === undefined ? {} : { migrations: config.migrations }),
    ...(config.introspect === undefined ? {} : { introspect: config.introspect }),
    ...(config.driver === undefined ? {} : { driver: config.driver }),
    ...(config.namingStrategy === undefined ? {} : { namingStrategy: config.namingStrategy }),
  };
}

async function runModules(parsed: ParsedCommand, io: RuntimeEnvironment): Promise<number> {
  const output = new CliOutput('modules', parsed.config, parsed.json, io);
  const options = parseModules(parsed, io.cwd);
  if ('error' in options) return output.failure(options.error, 2);
  if (parsed.json && options.formatWasNamed) {
    return output.failure('--json and --format ask for opposite output shapes', 2);
  }

  let root: ModuleClass;
  try {
    root = await loadRootModule(options.moduleSpec, io.cwd);
  } catch (error) {
    return output.failure(errorMessage(error), 2);
  }

  const graph = describeGraph(root);
  const exitCode = graph.findings.some(finding => finding.severity === 'error') ? 1 : 0;
  if (parsed.json) return output.result(graph, '', exitCode);

  let rendered: string;
  try {
    rendered = options.format === 'dot' ? renderDot(graph, options.filter) : renderTree(graph, options.filter);
  } catch (error) {
    return output.failure(errorMessage(error), 2);
  }
  if (options.format === 'dot') {
    for (const finding of graph.findings) {
      output.writeStderr(`${finding.severity}: ${finding.kind}: ${finding.message}\n`);
    }
  }
  return output.result(graph, rendered, exitCode);
}

function parseModules(parsed: ParsedCommand, cwd: string): ModulesOptions | { readonly error: string } {
  const moduleSpec = parsed.positionals[0];
  if (moduleSpec === undefined && isWorkspaceRoot(cwd)) {
    return {
      error: `a workspace root must name the application as <path>#<export>; the default is ${DEFAULT_MODULE_SPEC}`,
    };
  }

  const namedFormat = parsed.values.format;
  if (namedFormat !== undefined && namedFormat !== 'tree' && namedFormat !== 'dot') {
    return { error: `--format must be tree or dot, received "${String(namedFormat)}"` };
  }
  const depthValue = parsed.values.depth;
  const depth = typeof depthValue === 'string' ? Number(depthValue) : undefined;
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) {
    return { error: `--depth needs a non-negative integer, received "${String(depthValue)}"` };
  }

  const moduleName = typeof parsed.values.module === 'string' ? parsed.values.module : undefined;
  const token = typeof parsed.values.token === 'string' ? parsed.values.token : undefined;
  const filter: GraphFilter = {
    ...(parsed.values.providers === true ? { providers: true } : {}),
    ...(moduleName === undefined ? {} : { module: moduleName }),
    ...(token === undefined ? {} : { token }),
    ...(depth === undefined ? {} : { depth }),
  };
  return {
    moduleSpec: moduleSpec ?? DEFAULT_MODULE_SPEC,
    format: namedFormat === 'dot' ? 'dot' : 'tree',
    formatWasNamed: namedFormat !== undefined,
    filter,
  };
}

async function loadRootModule(moduleSpec: string, cwd: string): Promise<ModuleClass> {
  const hash = moduleSpec.lastIndexOf('#');
  if (hash <= 0 || hash === moduleSpec.length - 1) {
    throw new Error(`module spec "${moduleSpec}" must be <path>#<export>`);
  }
  const namedPath = moduleSpec.slice(0, hash);
  const exportName = moduleSpec.slice(hash + 1);
  const file = resolve(cwd, namedPath);
  if (!existsSync(file)) {
    throw new Error(`module path "${namedPath}" does not exist; cannot load export "${exportName}"`);
  }

  await installApplicationLoader();
  let loaded: object;
  try {
    const candidate: unknown = await import(pathToFileURL(file).href);
    if (typeof candidate !== 'object' || candidate === null) {
      throw new Error(`module path "${namedPath}" did not load as a module record`);
    }
    loaded = candidate;
  } catch (error) {
    throw new Error(`could not import module path "${namedPath}" for export "${exportName}": ${errorMessage(error)}`, {
      cause: error,
    });
  }
  const root: unknown = Reflect.get(loaded, exportName);
  if (!isModuleClass(root)) {
    throw new Error(`module path "${namedPath}" has no class export "${exportName}"`);
  }
  return root;
}

/**
 * Lower Stage-3 decorators while importing application TypeScript.
 *
 * Node 26 strips types but does not parse standard decorator syntax. The hook
 * applies the same esbuild transform used by the repository's Vitest setup, and
 * only after the CLI command asks to import application source.
 */
async function installApplicationLoader(): Promise<void> {
  applicationLoader ??= import('esbuild').then(({ transformSync }) => {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL !== undefined && /^\.{1,2}\/.*\.js$/.test(specifier)) {
          const asJavaScript = new URL(specifier, context.parentURL);
          if (!existsSync(fileURLToPath(asJavaScript))) {
            const asTypeScript = new URL(`${specifier.slice(0, -'.js'.length)}.ts`, context.parentURL);
            if (existsSync(fileURLToPath(asTypeScript))) {
              return { url: asTypeScript.href, shortCircuit: true };
            }
          }
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (!url.startsWith('file:') || !/\.[cm]?tsx?$/.test(new URL(url).pathname)) {
          return nextLoad(url, context);
        }
        const file = fileURLToPath(url);
        const transformed = transformSync(readFileSync(file, 'utf8'), {
          loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
          format: 'esm',
          target: 'es2022',
          sourcefile: file,
          sourcemap: 'inline',
          tsconfigRaw: {
            compilerOptions: {
              experimentalDecorators: false,
              useDefineForClassFields: true,
            },
          },
        });
        return { format: 'module', source: transformed.code, shortCircuit: true };
      },
    });
  });
  await applicationLoader;
}

async function runRepl(parsed: ParsedCommand, io: RuntimeEnvironment): Promise<number> {
  const output = new CliOutput('repl', parsed.config, parsed.json, io);
  if (parsed.json) {
    return output.failure('--json is unavailable because an interactive session is not one JSON document', 2);
  }
  if (!io.stdinIsTTY) {
    return output.failure('stdin must be a TTY; piped or network-controlled input is refused', 2);
  }

  const options = parseRepl(parsed, io.cwd);
  if ('error' in options) return output.failure(options.error, 2);

  let root: ModuleClass;
  try {
    root = await loadRootModule(options.moduleSpec, io.cwd);
  } catch (error) {
    return output.failure(errorMessage(error), 2);
  }

  try {
    await using session = await createReplSession(root, {
      configPath: parsed.config,
      moduleSpec: options.moduleSpec,
      cwd: io.cwd,
      input: io.input,
      output: io.output,
      stderr: text => output.writeStderr(text),
      historyPath: options.history ? replHistoryPath(io.environment, io.homeDirectory) : null,
      terminal: io.stdinIsTTY && streamIsTTY(io.output),
    });
    await session.closed;
    return 0;
  } catch (error) {
    return output.failure(errorMessage(error), 1);
  }
}

function parseRepl(parsed: ParsedCommand, cwd: string): ReplOptions | { readonly error: string } {
  const moduleSpec = parsed.positionals[0];
  if (moduleSpec === undefined && isWorkspaceRoot(cwd)) {
    return {
      error: `a workspace root must name the application as <path>#<export>; the default is ${DEFAULT_MODULE_SPEC}`,
    };
  }
  return {
    moduleSpec: moduleSpec ?? DEFAULT_MODULE_SPEC,
    history: parsed.values.history !== false,
  };
}

function runtimeEnvironment(environment: CliEnvironment): RuntimeEnvironment {
  const output = environment.output ?? process.stdout;
  return {
    cwd: environment.cwd ?? process.cwd(),
    stdinIsTTY: environment.stdinIsTTY ?? process.stdin.isTTY === true,
    input: environment.input ?? process.stdin,
    output,
    stdout: environment.stdout ?? (text => output.write(text)),
    stderr: environment.stderr ?? (text => process.stderr.write(text)),
    environment: environment.environment ?? process.env,
    homeDirectory: environment.homeDirectory ?? homedir(),
  };
}

function streamIsTTY(stream: NodeJS.WritableStream): boolean {
  return 'isTTY' in stream && stream.isTTY === true;
}

function isWorkspaceRoot(cwd: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null) return false;
    const workspaces: unknown = Reflect.get(manifest, 'workspaces');
    return Array.isArray(workspaces) || (typeof workspaces === 'object' && workspaces !== null);
  } catch {
    return false;
  }
}

function readPackageVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  );
  if (typeof manifest !== 'object' || manifest === null) return 'unknown';
  const version: unknown = Reflect.get(manifest, 'version');
  return typeof version === 'string' ? version : 'unknown';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isModuleClass(value: unknown): value is ModuleClass {
  return typeof value === 'function';
}
