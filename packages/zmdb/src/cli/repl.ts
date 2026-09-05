import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { start, type REPLServer } from 'node:repl';

import type { Token } from '@zmdb/app/di';
import { moduleDefOf, type ModuleClass } from '@zmdb/app/modules';
import { createApp, type App } from '@zmdb/web/app';
import { describeGraph, renderTree, type GraphDescription } from '@zmdb/web/devtools';
import type { WebRequest, WebResponse } from '@zmdb/web/pipeline';

export interface ReplGet {
  <T>(token: Token<T>): T;
  (description: string): unknown;
}

export interface ReplScope {
  readonly app: App;
  readonly container: App['container'];
  readonly get: ReplGet;
  readonly tokens: readonly string[];
  readonly describe: () => string;
  readonly request: (request: WebRequest | string) => Promise<WebResponse>;
  readonly load: (name: string) => Promise<void>;
}

export interface ReplSessionOptions {
  readonly configPath: string;
  readonly moduleSpec: string;
  readonly cwd?: string;
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly stderr?: (text: string) => void;
  readonly historyPath?: string | null;
  readonly terminal?: boolean;
}

export interface ReplSession extends AsyncDisposable {
  readonly app: App;
  readonly graph: GraphDescription;
  readonly scope: ReplScope;
  readonly server: REPLServer;
  readonly closed: Promise<void>;
  evaluate(source: string): Promise<unknown>;
}

interface TokenRecord {
  readonly token: Token<unknown>;
  readonly description: string;
}

/**
 * Boot the real application and start a local, stream-only Node REPL.
 *
 * No socket or adapter is created. The caller owns the returned async resource;
 * disposing it closes the prompt and runs the application's normal shutdown
 * lifecycle.
 */
export async function createReplSession(rootModule: ModuleClass, options: ReplSessionOptions): Promise<ReplSession> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const stderr = options.stderr ?? (text => process.stderr.write(text));
  const cwd = options.cwd ?? process.cwd();
  const graph = describeGraph(rootModule);
  const tokenRecords = providerTokensOf(rootModule);
  const app = createApp(rootModule);

  try {
    await app.init();
  } catch (error) {
    await app[Symbol.asyncDispose]();
    throw error;
  }

  const scope = replScope(app, graph, tokenRecords);
  stderr(
    [
      'zmdb repl — development shell with the application container',
      `config: ${options.configPath}`,
      'dialect: application-owned (the application does not read zmdb.config.ts)',
      'database: application-owned (provider values are not inspected or printed)',
      `module: ${options.moduleSpec} (${rootModule.name || '<anonymous>'})`,
      'scope: app, container, get(tokenOrDescription), tokens, describe(), request(req), load(name)',
      `tokens: ${scope.tokens.length === 0 ? '(none)' : scope.tokens.join(', ')}`,
      `history: ${options.historyPath === null ? 'disabled' : (options.historyPath ?? 'disabled')}`,
      '',
    ].join('\n'),
  );

  let server: REPLServer | undefined;
  try {
    server = start({
      prompt: 'zmdb> ',
      input,
      output,
      terminal: options.terminal,
      ignoreUndefined: true,
    });
    const activeServer = server;
    let closed = false;
    const enteredLines: string[] = [];
    if (options.historyPath !== null && options.historyPath !== undefined) {
      activeServer.on('line', line => {
        if (line.length > 0 && line !== '.exit') {
          enteredLines.unshift(line);
        }
      });
    }
    const historyReady = Promise.withResolvers<() => Promise<void>>();
    const whenClosed = new Promise<void>((resolveClosed, rejectClosed) => {
      activeServer.once('exit', () => {
        closed = true;
        void historyReady.promise.then(flush => flush()).then(resolveClosed, rejectClosed);
      });
    });
    Object.assign(activeServer.context, scope);

    try {
      const flushHistory =
        options.historyPath === null || options.historyPath === undefined
          ? async (): Promise<void> => {}
          : await configureHistory(activeServer, options.historyPath, cwd, enteredLines);
      historyReady.resolve(flushHistory);
    } catch (error) {
      historyReady.resolve(async (): Promise<void> => {});
      throw error;
    }

    let disposed = false;
    return {
      app,
      graph,
      scope,
      server: activeServer,
      closed: whenClosed,
      evaluate: source => evaluate(activeServer, source),
      [Symbol.asyncDispose]: async () => {
        if (disposed) {
          return;
        }
        disposed = true;
        if (!closed) {
          activeServer.close();
        }
        try {
          await whenClosed;
        } finally {
          await app[Symbol.asyncDispose]();
        }
      },
    };
  } catch (error) {
    server?.close();
    await app[Symbol.asyncDispose]();
    throw error;
  }
}

/** Resolve the default history path without ever making it relative to the project. */
export function replHistoryPath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory: string = homedir(),
): string {
  const configured = environment['ZMDB_REPL_HISTORY'];
  if (configured === undefined || configured.length === 0) {
    return resolve(homeDirectory, '.zmdb_repl_history');
  }
  return isAbsolute(configured) ? configured : resolve(homeDirectory, configured);
}

function replScope(app: App, graph: GraphDescription, records: readonly TokenRecord[]): ReplScope {
  const get = createGet(app, records);
  const tokens = graph.providers.map(provider => provider.token).toSorted();
  return {
    app,
    container: app.container,
    get,
    tokens,
    describe: () => renderTree(graph, graph.providers.length <= 50 ? { providers: true } : undefined),
    request: request => {
      const input: WebRequest = typeof request === 'string' ? { method: 'GET', path: request, headers: {} } : request;
      return app.handle(input);
    },
    load: async name => {
      const matches = app.lazy.filter(handle => handle.name === name);
      if (matches.length === 0) {
        throw new Error(`zmdb repl: no lazy module named "${name}"`);
      }
      if (matches.length > 1) {
        throw new Error(`zmdb repl: lazy module name "${name}" is ambiguous (${String(matches.length)} handles)`);
      }
      await matches[0]?.load();
    },
  };
}

function createGet(app: App, records: readonly TokenRecord[]): ReplGet {
  return <T>(tokenOrDescription: Token<T> | string): T | unknown => {
    if (typeof tokenOrDescription !== 'string') {
      return app.container.resolve(tokenOrDescription);
    }
    const matches = records.filter(record => record.description === tokenOrDescription);
    if (matches.length === 0) {
      throw new Error(`zmdb repl: no provider token is described as "${tokenOrDescription}"`);
    }
    if (matches.length > 1) {
      throw new Error(
        `zmdb repl: token description "${tokenOrDescription}" is ambiguous (${String(matches.length)} distinct tokens)`,
      );
    }
    const record = matches[0];
    if (record === undefined) {
      throw new Error(`zmdb repl: no provider token is described as "${tokenOrDescription}"`);
    }
    return app.container.resolve(record.token);
  };
}

function providerTokensOf(rootModule: ModuleClass): readonly TokenRecord[] {
  const seenModules = new Set<ModuleClass>();
  const seenTokens = new Set<Token<unknown>>();
  const records: TokenRecord[] = [];

  const visit = (moduleClass: ModuleClass): void => {
    if (seenModules.has(moduleClass)) {
      return;
    }
    seenModules.add(moduleClass);
    const definition = moduleDefOf(moduleClass);
    for (const provider of definition?.providers ?? []) {
      if (!seenTokens.has(provider.token)) {
        seenTokens.add(provider.token);
        records.push({ token: provider.token, description: provider.token.description });
      }
    }
    for (const imported of definition?.imports ?? []) {
      visit(typeof imported === 'function' ? imported : imported.module);
    }
  };

  visit(rootModule);
  return records;
}

async function configureHistory(
  server: REPLServer,
  historyPath: string,
  cwd: string,
  enteredLines: readonly string[],
): Promise<() => Promise<void>> {
  if (isWithin(projectRootOf(cwd), historyPath)) {
    throw new Error(`zmdb repl: history path "${historyPath}" must be outside the project tree`);
  }
  await mkdir(dirname(historyPath), { recursive: true, mode: 0o700 });
  let existing = '';
  try {
    existing = await readFile(historyPath, 'utf8');
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  await writeFile(historyPath, existing, { encoding: 'utf8', mode: 0o600 });
  await chmod(historyPath, 0o600);
  const existingLines = existing.split(/\r?\n/).filter(line => line.length > 0);
  Reflect.set(server, 'history', existingLines);

  return async () => {
    const lines = [...enteredLines, ...existingLines];
    await writeFile(historyPath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
    await chmod(historyPath, 0o600);
  };
}

function projectRootOf(cwd: string): string {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(resolve(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }
    current = parent;
  }
}

function isWithin(base: string, target: string): boolean {
  const path = relative(resolve(base), resolve(target));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function evaluate(server: REPLServer, source: string): Promise<unknown> {
  const command = source.endsWith('\n') ? source : `${source}\n`;
  return new Promise<unknown>((resolveResult, rejectResult) => {
    server.eval(command, server.context, 'zmdb-repl', (error, result) => {
      if (error === null) {
        resolveResult(result);
      } else {
        rejectResult(error);
      }
    });
  });
}
