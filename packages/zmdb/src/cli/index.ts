// zmdb/cli — argument handling for developer and schema commands.
//
// The module inspector and REPL live on a build-time subpath so esbuild,
// node:repl and the application-source loader cannot enter a server bundle
// through any runtime export.

import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describeGraph, renderDot, renderTree, type GraphDescription, type GraphFilter } from '@zmdb/web/devtools';
import type { ModuleClass } from '@zmdb/web/modules';

import { createReplSession, replHistoryPath } from './repl.js';

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

export interface CliResult<T> {
  readonly ok: boolean;
  readonly command: string;
  readonly config: string;
  readonly result?: T;
  readonly errors?: readonly { readonly message: string; readonly path?: string }[];
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
  readonly json: boolean;
  readonly filter: GraphFilter;
  readonly config: string;
}

interface ReplOptions {
  readonly moduleSpec: string;
  readonly config: string;
  readonly history: boolean;
}

const DEFAULT_MODULE_SPEC = './src/app.module.ts#AppModule';
const USAGE = `zmdb — schema and application developer tools.

  zmdb modules [path#export] [--format tree|dot] [--providers]
               [--module <name>] [--token <description>] [--depth <n>] [--json]
  zmdb repl [path#export] [--no-history]

The modules command describes declarations without constructing providers.
The repl command requires a TTY and never opens a network listener.
`;

let applicationLoader: Promise<void> | undefined;

/** Run the CLI against injectable streams, returning its process exit code. */
export async function runCli(argv: readonly string[], environment: CliEnvironment = {}): Promise<number> {
  const io = runtimeEnvironment(environment);
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout(USAGE);
    return 0;
  }

  const command = argv[0];
  if (command === undefined) {
    io.stderr(USAGE);
    return 2;
  }
  if (command === 'graph') {
    io.stderr('zmdb: "graph" is ambiguous in a schema tool; use "zmdb modules"\n');
    return 2;
  }
  if (command === 'modules') {
    return runModules(argv.slice(1), io);
  }
  if (command === 'repl') {
    return runRepl(argv.slice(1), io);
  }

  io.stderr(`zmdb: unknown command "${command}"\n`);
  return 2;
}

async function runModules(argv: readonly string[], io: RuntimeEnvironment): Promise<number> {
  const parsed = parseModules(argv, io.cwd);
  if ('error' in parsed) {
    return invocationError('modules', parsed.config, parsed.json, parsed.error, io);
  }
  if (parsed.json && parsed.formatWasNamed) {
    return invocationError('modules', parsed.config, true, '--json and --format ask for opposite output shapes', io);
  }

  let root: ModuleClass;
  try {
    root = await loadRootModule(parsed.moduleSpec, io.cwd);
  } catch (error) {
    return invocationError(
      'modules',
      parsed.config,
      parsed.json,
      error instanceof Error ? error.message : String(error),
      io,
    );
  }

  const graph = describeGraph(root);
  const ok = !graph.findings.some(finding => finding.severity === 'error');
  if (parsed.json) {
    const result: CliResult<GraphDescription> = {
      ok,
      command: 'modules',
      config: parsed.config,
      result: graph,
    };
    io.stdout(`${JSON.stringify(result)}\n`);
    return ok ? 0 : 1;
  }

  let rendered: string;
  try {
    rendered = parsed.format === 'dot' ? renderDot(graph, parsed.filter) : renderTree(graph, parsed.filter);
  } catch (error) {
    return invocationError('modules', parsed.config, false, error instanceof Error ? error.message : String(error), io);
  }
  io.stdout(rendered);
  if (parsed.format === 'dot') {
    for (const finding of graph.findings) {
      io.stderr(`${finding.severity}: ${finding.kind}: ${finding.message}\n`);
    }
  }
  return ok ? 0 : 1;
}

function parseModules(
  argv: readonly string[],
  cwd: string,
): ModulesOptions | { readonly error: string; readonly json: boolean; readonly config: string } {
  let moduleSpec: string | undefined;
  let format: 'tree' | 'dot' = 'tree';
  let formatWasNamed = false;
  let json = false;
  let providers = false;
  let moduleName: string | undefined;
  let token: string | undefined;
  let depth: number | undefined;
  let config = resolve(cwd, 'zmdb.config.ts');

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (!argument.startsWith('-')) {
      if (moduleSpec !== undefined) {
        return { error: `unexpected positional argument "${argument}"`, json, config };
      }
      moduleSpec = argument;
      continue;
    }
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--providers') {
      providers = true;
      continue;
    }
    if (argument === '--yes' || argument === '--force') {
      continue;
    }
    if (argument === '--format') {
      const value = argv[index + 1];
      if (value === undefined) {
        return { error: '--format needs tree or dot', json, config };
      }
      if (value !== 'tree' && value !== 'dot') {
        return { error: `--format must be tree or dot, received "${value}"`, json, config };
      }
      format = value;
      formatWasNamed = true;
      index += 1;
      continue;
    }
    if (argument === '--module') {
      const value = argv[index + 1];
      if (value === undefined) {
        return { error: '--module needs a name', json, config };
      }
      moduleName = value;
      index += 1;
      continue;
    }
    if (argument === '--token') {
      const value = argv[index + 1];
      if (value === undefined) {
        return { error: '--token needs a description', json, config };
      }
      token = value;
      index += 1;
      continue;
    }
    if (argument === '--depth') {
      const value = argv[index + 1];
      if (value === undefined) {
        return { error: '--depth needs a non-negative integer', json, config };
      }
      depth = Number(value);
      if (!Number.isInteger(depth) || depth < 0) {
        return { error: `--depth needs a non-negative integer, received "${value}"`, json, config };
      }
      index += 1;
      continue;
    }
    if (argument === '--config') {
      const value = argv[index + 1];
      if (value === undefined) {
        return { error: '--config needs a path', json, config };
      }
      config = resolve(cwd, value);
      index += 1;
      continue;
    }
    return { error: `unknown option "${argument}"`, json, config };
  }

  if (moduleSpec === undefined && isWorkspaceRoot(cwd)) {
    return {
      error: `a workspace root must name the application as <path>#<export>; the default is ${DEFAULT_MODULE_SPEC}`,
      json,
      config,
    };
  }

  const filter: GraphFilter = {
    ...(providers ? { providers: true } : {}),
    ...(moduleName === undefined ? {} : { module: moduleName }),
    ...(token === undefined ? {} : { token }),
    ...(depth === undefined ? {} : { depth }),
  };
  return {
    moduleSpec: moduleSpec ?? DEFAULT_MODULE_SPEC,
    format,
    formatWasNamed,
    json,
    filter,
    config,
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
    throw new Error(
      `could not import module path "${namedPath}" for export "${exportName}": ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
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

async function runRepl(argv: readonly string[], io: RuntimeEnvironment): Promise<number> {
  if (argv.includes('--json')) {
    io.stderr('zmdb repl: --json is unavailable because an interactive session is not one JSON document\n');
    return 2;
  }
  if (!io.stdinIsTTY) {
    io.stderr('zmdb repl: stdin must be a TTY; piped or network-controlled input is refused\n');
    return 2;
  }

  const parsed = parseRepl(argv, io.cwd);
  if ('error' in parsed) {
    io.stderr(`zmdb repl: ${parsed.error}\n`);
    return 2;
  }

  let root: ModuleClass;
  try {
    root = await loadRootModule(parsed.moduleSpec, io.cwd);
  } catch (error) {
    io.stderr(`zmdb repl: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  try {
    await using session = await createReplSession(root, {
      configPath: parsed.config,
      moduleSpec: parsed.moduleSpec,
      cwd: io.cwd,
      input: io.input,
      output: io.output,
      stderr: io.stderr,
      historyPath: parsed.history ? replHistoryPath(io.environment, io.homeDirectory) : null,
      terminal: io.stdinIsTTY && streamIsTTY(io.output),
    });
    await session.closed;
    return 0;
  } catch (error) {
    io.stderr(`zmdb repl: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseRepl(argv: readonly string[], cwd: string): ReplOptions | { readonly error: string } {
  let moduleSpec: string | undefined;
  let config = resolve(cwd, 'zmdb.config.ts');
  let history = true;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (!argument.startsWith('-')) {
      if (moduleSpec !== undefined) {
        return { error: `unexpected positional argument "${argument}"` };
      }
      moduleSpec = argument;
      continue;
    }
    if (argument === '--no-history') {
      history = false;
      continue;
    }
    if (argument === '--yes' || argument === '--force') {
      continue;
    }
    if (argument === '--config') {
      const value = argv[index + 1];
      if (value === undefined) {
        return { error: '--config needs a path' };
      }
      config = resolve(cwd, value);
      index += 1;
      continue;
    }
    return { error: `unknown option "${argument}"` };
  }

  if (moduleSpec === undefined && isWorkspaceRoot(cwd)) {
    return {
      error: `a workspace root must name the application as <path>#<export>; the default is ${DEFAULT_MODULE_SPEC}`,
    };
  }
  return { moduleSpec: moduleSpec ?? DEFAULT_MODULE_SPEC, config, history };
}

function invocationError(
  command: string,
  config: string,
  json: boolean,
  message: string,
  io: RuntimeEnvironment,
): number {
  if (json) {
    const result: CliResult<never> = {
      ok: false,
      command,
      config,
      errors: [{ message }],
    };
    io.stdout(`${JSON.stringify(result)}\n`);
  } else {
    io.stderr(`zmdb ${command}: ${message}\n`);
  }
  return 2;
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
    if (typeof manifest !== 'object' || manifest === null) {
      return false;
    }
    const record: { workspaces?: unknown } = manifest;
    return Array.isArray(record.workspaces) || (typeof record.workspaces === 'object' && record.workspaces !== null);
  } catch {
    return false;
  }
}

function isModuleClass(value: unknown): value is ModuleClass {
  return typeof value === 'function';
}
