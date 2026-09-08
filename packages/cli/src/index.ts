// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// @zmdb/cli — argument handling for developer and schema commands.
//
// The executable is a build-time boundary: config loading, TypeScript
// reflection, esbuild and node:repl must not enter an application bundle.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import type { ModuleClass } from '@zmdb/app/modules';
import type { ResolvedConfig, ZmdbConfig } from '@zmdb/compiler/config';
import type { GraphFilter } from '@zmdb/web/devtools';

import { loadRootModule, requireOptionalPeer } from './application-loader.js';
import { commandHelp, globalHelp, parseCommand, type ParsedCommand } from './args.js';
import type { CheckResult } from './commands/check.js';
import type {
  GenerateHttpArtifactsOptions,
  HttpArtifactGeneration,
  WatchHttpArtifactsOptions,
} from './commands/client.js';
import type { EmbedOptions, EmbedResult } from './commands/embed.js';
import type { exportSchema as exportSchemaCommand, ExportResult } from './commands/export.js';
import type { GenerateOptions, GenerateResult } from './commands/generate.js';
import type { MigrateResult, RollbackResult, StatusResult } from './commands/migrate.js';
import type { PullExecution, PullOptions, PullResult } from './commands/pull.js';
import type { PushResult } from './commands/push.js';
import type { UpgradeResult } from './commands/upgrade.js';
import { CliInvocationError, errorMessage } from './errors.js';
import { withConfiguredDriver, withSignals } from './lifecycle.js';
import { CliOutput, type CliResult } from './output.js';

const requireCommand = createRequire(import.meta.url);

export async function embedMigrations(config: ResolvedConfig, options: EmbedOptions = {}): Promise<EmbedResult> {
  const command = await import('./commands/embed.js');
  return command.embedMigrations(config, options);
}

export function exportSchema(config: ResolvedConfig): ExportResult {
  // boundary: Node require is untyped; this literal private module and the named
  // function type above share the same source owner.
  const command: { readonly exportSchema: typeof exportSchemaCommand } = requireCommand('./commands/export.js');
  return command.exportSchema(config);
}

export async function generateMigration(
  config: ResolvedConfig,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const command = await import('./commands/generate.js');
  return command.generateMigration(config, options);
}

export async function pullDeclarations(config: ResolvedConfig, options: PullOptions = {}): Promise<PullExecution> {
  const command = await import('./commands/pull.js');
  return withConfiguredDriver(config, scoped => command.pullDeclarations(scoped, options));
}

export type {
  CheckResult,
  CliResult,
  EmbedOptions,
  EmbedResult,
  ExportResult,
  GenerateHttpArtifactsOptions,
  GenerateOptions,
  GenerateResult,
  HttpArtifactGeneration,
  MigrateResult,
  PullOptions,
  PullResult,
  PushResult,
  RollbackResult,
  StatusResult,
  UpgradeResult,
  WatchHttpArtifactsOptions,
};
export type { ClientGenerateResult } from './commands/client.js';

/** Programmatic generation stays on the same lazy boundary as the CLI command. */
export async function generateHttpArtifacts(
  config: ResolvedConfig,
  options: GenerateHttpArtifactsOptions = {},
): Promise<HttpArtifactGeneration> {
  requireOptionalPeer('@zmdb/web');
  const command = await import('./commands/client.js');
  return command.generateHttpArtifacts(config, options);
}

/** Programmatic watch mode retains the same lazy build-time dependency boundary. */
export async function watchHttpArtifacts(
  config: ResolvedConfig,
  options: WatchHttpArtifactsOptions = {},
): Promise<HttpArtifactGeneration> {
  requireOptionalPeer('@zmdb/web');
  const command = await import('./commands/client.js');
  return command.watchHttpArtifacts(config, options);
}

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
    if (command === 'studio' && !parsedResult.json) {
      io.stderr(`zmdb: ${parsedResult.error}\n`);
      return 2;
    }
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
  if (command === 'rollback') {
    try {
      rollbackTarget(parsed.values.to);
    } catch (error) {
      return output.failure(errorMessage(error), 2);
    }
  }
  if (['modules', 'repl', 'studio', 'client'].includes(command)) {
    try {
      requireOptionalPeer('@zmdb/web');
      if (command === 'modules' || command === 'repl') requireOptionalPeer('@zmdb/app');
    } catch (error) {
      return output.failure(errorMessage(error), error instanceof CliInvocationError ? 2 : 1);
    }
  }
  if (command === 'codegen') {
    const { runCodegen } = await import('./commands/codegen.js');
    return runCodegen(parsed, io);
  }
  if (command === 'new') {
    const { createNewScaffold } = await import('./commands/new.js');
    return createNewScaffold(parsed, output, io.cwd);
  }
  if (command === 'studio') return runStudioCommand(parsed, io);
  if (command === 'modules') return runModules(parsed, io);
  if (command === 'repl') return runRepl(parsed, io);
  if (command === 'client') return runClientCommand(parsed, io);
  return runDatabaseCommand(parsed, io);
}

async function runClientCommand(parsed: ParsedCommand, io: RuntimeEnvironment): Promise<number> {
  const pendingOutput = new CliOutput('client generate', parsed.config, parsed.json, io);
  if (parsed.positionals[0] !== 'generate') {
    return pendingOutput.failure('expected the subcommand `generate`', 2);
  }
  if (parsed.values.check === true && parsed.values.watch === true) {
    return pendingOutput.failure('--check and --watch ask for opposite things', 2);
  }
  if (parsed.json && parsed.values.watch === true) {
    return pendingOutput.failure('--json is unavailable because a watch session is not one JSON document', 2);
  }

  let config: ResolvedConfig;
  try {
    config = await loadCommandConfig(parsed, io.cwd);
  } catch (error) {
    return pendingOutput.failure(errorMessage(error), 2, parsed.config);
  }
  const output = pendingOutput.withConfig(config.configPath);

  try {
    const command = await import('./commands/client.js');
    if (parsed.values.watch === true) {
      await withSignals(until =>
        command.watchHttpArtifacts(config, {
          until,
          log: generation => {
            output.progress(renderClientGeneration(config.configPath, generation));
          },
        }),
      );
      return 0;
    }

    const check = parsed.values.check === true;
    const generation = await command.generateHttpArtifacts(config, check ? { check: true } : {});
    const exitCode = parsed.values.check === true && generation.stale.length > 0 ? 1 : 0;
    return output.result(generation.result, renderClientGeneration(config.configPath, generation, check), exitCode);
  } catch (error) {
    return output.failure(errorMessage(error), error instanceof CliInvocationError ? 2 : 1);
  }
}

async function runStudioCommand(parsed: ParsedCommand, io: RuntimeEnvironment): Promise<number> {
  const pendingOutput = new CliOutput('studio', parsed.config, parsed.json, io);
  if (parsed.json) {
    return pendingOutput.failure('--json is unavailable because a studio session is not one JSON document', 2);
  }

  const portValue = parsed.values.port;
  const port =
    portValue === undefined
      ? 0
      : typeof portValue === 'string' && /^(?:0|[1-9]\d*)$/.test(portValue)
        ? Number(portValue)
        : Number.NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    return pendingOutput.failure(`--port must be an integer from 0 through 65535, received "${String(portValue)}"`, 2);
  }

  let config: ResolvedConfig;
  try {
    config = await loadCommandConfig(parsed, io.cwd);
  } catch (error) {
    return pendingOutput.failure(errorMessage(error), 2, parsed.config);
  }
  const output = pendingOutput.withConfig(config.configPath);
  if (config.driver === undefined) {
    return output.failure('the config must declare a driver thunk before studio can connect', 2);
  }

  try {
    const { schemasFromFiles } = await import('@zmdb/compiler/testing');
    const schemas = schemasFromFiles(config.schemaFiles, {
      project: config.project,
      naming: config.resolvedNaming,
    });
    return await withConfiguredDriver(config, async scoped => {
      if (scoped.driver === undefined) throw new CliInvocationError('studio needs a driver');
      const [driver, { runStudio }] = await Promise.all([scoped.driver(), import('./commands/studio.js')]);
      return runStudio(
        { schemas, driver, dialect: config.dialect },
        {
          port,
          stdout: text => output.writeStdout(text),
          stderr: text => output.writeStderr(text),
        },
      );
    });
  } catch (error) {
    return output.failure(errorMessage(error), 1);
  }
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
    const publish = await withConfiguredDriver(config, async scopedConfig => {
      if (parsed.command === 'embed') {
        const out = typeof parsed.values.out === 'string' ? parsed.values.out : undefined;
        const result = await embedMigrations(scopedConfig, {
          ...(out === undefined ? {} : { out }),
          ...(parsed.values['with-down'] === true ? { withDown: true } : {}),
        });
        return () =>
          output.result(
            result,
            `${scopedConfig.configPath}\nwrote ${result.file} (${String(result.migrations.length)} migrations)\n`,
          );
      }
      if (parsed.command === 'generate') {
        const name = typeof parsed.values.name === 'string' ? parsed.values.name : undefined;
        if (name !== undefined && !/[a-z0-9]/i.test(name)) {
          return () => output.failure(`migration name ${JSON.stringify(name)} has no letters or digits`, 2);
        }
        const result = await generateMigration(scopedConfig, name === undefined ? {} : { name });
        const human =
          'file' in result
            ? `${scopedConfig.configPath}\nwrote ${result.file} (${String(result.ops.length)} operations)\n`
            : `${scopedConfig.configPath}\nno changes; no migration written\n`;
        return () => output.result(result, human);
      }
      if (parsed.command === 'export') {
        const result = (await import('./commands/export.js')).exportSchema(scopedConfig);
        const sql = result.statements.length === 0 ? '' : `${result.statements.join(';\n')};\n`;
        return () => output.result(result, `-- zmdb config: ${scopedConfig.configPath}\n${sql}`);
      }
      if (parsed.command === 'migrate') {
        output.progress(`${scopedConfig.configPath}\n`);
        const result = await (
          await import('./commands/migrate.js')
        ).migrate(scopedConfig, { progress: text => output.progress(text) });
        return () =>
          output.result(
            result,
            result.applied.length === 0
              ? 'nothing to apply; 0 pending migrations\n'
              : `applied ${result.applied.map(item => String(item.version)).join(', ')}\n`,
          );
      }
      if (parsed.command === 'rollback') {
        output.progress(`${scopedConfig.configPath}\n`);
        const target = rollbackTarget(parsed.values.to);
        const result = await (
          await import('./commands/migrate.js')
        ).rollback(scopedConfig, target, { progress: text => output.progress(text) });
        return () =>
          output.result(
            result,
            result.versions.length === 0
              ? 'nothing to roll back\n'
              : `reverted ${result.versions.map(item => String(item.version)).join(', ')}\n`,
          );
      }
      if (parsed.command === 'status') {
        output.progress(`${scopedConfig.configPath}\n`);
        const result = await (await import('./commands/migrate.js')).migrationStatus(scopedConfig);
        const human = result.migrations
          .map(item => `${item.applied ? '[x]' : '[ ]'} ${String(item.version)} ${item.name}`)
          .join('\n');
        return () => output.result(result, human.length === 0 ? 'no migrations\n' : `${human}\n`);
      }
      if (parsed.command === 'push') {
        output.progress(`${scopedConfig.configPath}\n`);
        const plan = await (await import('./commands/push.js')).planPush(scopedConfig);
        for (const statement of plan.statements) output.progress(`${statement};\n`);
        if (plan.destructive.length > 0 && parsed.values.force !== true) {
          return () => output.failure(`--force is required for destructive SQL:\n${plan.destructive.join(';\n')};`, 2);
        }
        if (plan.destructive.length > 0 && parsed.values.yes !== true && (parsed.json || !io.stdinIsTTY)) {
          return () => output.failure('--yes is required for a destructive push when no TTY prompt is available', 2);
        }
        if (
          plan.destructive.length > 0 &&
          parsed.values.yes !== true &&
          !(await confirmPush(io, plan.destructive.length))
        ) {
          return () => output.failure('push cancelled before executing SQL', 1);
        }
        const result = await (
          await import('./commands/push.js')
        ).applyPush(plan, warning => output.progress(`warning: ${warning}\n`));
        return () =>
          output.result(
            result,
            result.applied ? `applied ${String(result.statements.length)} statements\n` : 'no changes\n',
          );
      }
      if (parsed.command === 'check') {
        output.progress(`${scopedConfig.configPath}\n`);
        const result = await (await import('./commands/check.js')).checkProject(scopedConfig);
        const findings = result.findings.map(finding => `${finding.kind}: ${finding.message} (${finding.subject})`);
        const skipped = result.skipped.map(item => `skipped ${item.kind}: ${item.reason}`);
        const human = [...findings, ...skipped];
        return () =>
          output.result(result, `${human.join('\n') || 'check passed'}\n`, result.findings.length === 0 ? 0 : 1);
      }
      if (parsed.command === 'upgrade') {
        output.progress(`${scopedConfig.configPath}\n`);
        const result = await (await import('./commands/upgrade.js')).upgradeSnapshot(scopedConfig);
        return () =>
          output.result(
            result,
            result.changed
              ? `upgraded snapshot ${String(result.from)} -> ${String(result.to)}; backup ${result.backup ?? ''}\n`
              : `snapshot is already at version ${String(result.to)}\n`,
          );
      }
      if (parsed.command === 'pull') {
        if (scopedConfig.driver === undefined) {
          return () => output.failure('the config must declare a driver thunk before pull can connect', 2);
        }
        const execution = await (
          await import('./commands/pull.js')
        ).pullDeclarations(scopedConfig, {
          ...(parsed.values['dry-run'] === true ? { dryRun: true } : {}),
          ...(parsed.values.check === true ? { check: true } : {}),
        });
        if (parsed.json) {
          for (const warning of execution.warnings) output.writeStderr(`${formatPullWarning(warning)}\n`);
        }
        return () =>
          output.result(execution.result, renderPull(execution, scopedConfig.configPath), execution.exitCode);
      }
      return () => output.failure(`command "${parsed.command}" is not implemented`, 2);
    });
    return publish();
  } catch (error) {
    return output.failure(errorMessage(error), error instanceof CliInvocationError ? 2 : 1);
  }
}

function rollbackTarget(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new CliInvocationError(`--to needs a decimal migration version, received "${String(value)}"`);
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version)) {
    throw new CliInvocationError(`--to migration version ${value} is not a safe integer`);
  }
  return version;
}

async function confirmPush(io: RuntimeEnvironment, destructiveCount: number): Promise<boolean> {
  const prompt = createInterface({ input: io.input, output: io.output, terminal: true });
  try {
    const answer = await prompt.question(
      `Apply ${String(destructiveCount)} destructive statement${destructiveCount === 1 ? '' : 's'}? [y/N] `,
    );
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function loadCommandConfig(parsed: ParsedCommand, cwd: string): Promise<ResolvedConfig> {
  const { loadConfig, resolveConfig } = await import('@zmdb/compiler/config');
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
    ...(config.http === undefined
      ? {}
      : {
          http: {
            contracts: config.http.contracts.map(contract => `${contract.file}#${contract.exportName}`),
            openApi: { out: config.http.openApiOut },
            client: { out: config.http.clientOut },
          },
        }),
    ...(config.driver === undefined ? {} : { driver: config.driver }),
    ...(config.namingStrategy === undefined ? {} : { namingStrategy: config.namingStrategy }),
  };
}

function renderClientGeneration(configPath: string, generation: HttpArtifactGeneration, check = false): string {
  if (!generation.result.changed) return `${configPath}\nHTTP client artifacts are current\n`;
  const lines = [configPath];
  for (const path of generation.stale) lines.push(`${check ? 'stale' : 'generated'} ${path}`);
  return `${lines.join('\n')}\n`;
}

async function runModules(parsed: ParsedCommand, io: RuntimeEnvironment): Promise<number> {
  const output = new CliOutput('modules', parsed.config, parsed.json, io);
  const options = parseModules(parsed, io.cwd);
  if ('error' in options) return output.failure(options.error, 2);
  if (parsed.json && options.formatWasNamed) {
    return output.failure('--json and --format ask for opposite output shapes', 2);
  }

  try {
    const root = await loadRootModule(options.moduleSpec, io.cwd);

    const { describeGraph, renderDot, renderTree } = await import('@zmdb/web/devtools');
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
  } catch (error) {
    return output.failure(errorMessage(error), error instanceof CliInvocationError ? 2 : 1);
  }
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
    return output.failure(errorMessage(error), error instanceof CliInvocationError ? 2 : 1);
  }

  try {
    const { createReplSession, replHistoryPath } = await import('./repl.js');
    await withSignals(async until => {
      let session: Awaited<ReturnType<typeof createReplSession>> | undefined;
      try {
        session = await createReplSession(root, {
          configPath: parsed.config,
          moduleSpec: options.moduleSpec,
          cwd: io.cwd,
          input: io.input,
          output: io.output,
          stderr: text => output.writeStderr(text),
          historyPath: options.history ? replHistoryPath(io.environment, io.homeDirectory) : null,
          terminal: io.stdinIsTTY && streamIsTTY(io.output),
        });
        await Promise.race([session.closed, until]);
      } finally {
        if (session) {
          await session[Symbol.asyncDispose]();
        }
      }
    });
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
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  );
  if (typeof manifest !== 'object' || manifest === null) return 'unknown';
  const version: unknown = Reflect.get(manifest, 'version');
  return typeof version === 'string' ? version : 'unknown';
}

function renderPull(execution: PullExecution, configPath: string): string {
  const lines = [configPath];
  for (const warning of execution.warnings) lines.push(formatPullWarning(warning));

  const skipped = new Map(execution.result.skipped.map(file => [file.path, file.reason]));
  for (const output of execution.outputs) {
    const reason = skipped.get(output.path);
    if (reason !== undefined) {
      lines.push(`${execution.mode === 'check' ? 'drift' : 'skipped'} ${output.path}: ${reason}`);
      continue;
    }
    if (execution.mode === 'dry-run') {
      lines.push(`would write ${output.path}`, output.source.trimEnd());
    } else if (execution.mode === 'check') {
      lines.push(`current ${output.path}`);
    } else {
      lines.push(`wrote ${output.path}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function formatPullWarning(warning: {
  readonly table: string;
  readonly column?: string;
  readonly reason: string;
}): string {
  const subject = warning.column === undefined ? warning.table : `${warning.table}.${warning.column}`;
  return `WARNING ${subject}: ${warning.reason}`;
}
