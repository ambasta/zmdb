import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { createToken, Inject } from '@zmdb/web/di';
import { lazy, Module } from '@zmdb/web/modules';
import { Controller, Get } from '@zmdb/web/routing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from './index.js';
import { createReplSession, replHistoryPath, type ReplSession } from './repl.js';

const DATABASE = createToken<{ readonly name: string; onShutdown(): void }>('DATABASE');
const USERS = createToken<{ list(): string; onShutdown(): void }>('USERS');
const ADMIN = createToken<{ readonly enabled: true }>('ADMIN');
const shutdowns: string[] = [];

const database = {
  name: 'fixture',
  onShutdown(): void {
    shutdowns.push('database');
  },
};

@Controller('/users')
class UsersController {
  @Inject(USERS)
  users!: { list(): string; onShutdown(): void };

  @Get('/')
  list(): string {
    return this.users.list();
  }
}

@Module({
  providers: [
    { token: DATABASE, useValue: database },
    {
      token: USERS,
      useFactory: container => {
        const db = container.resolve(DATABASE);
        return {
          list: () => `users@${db.name}`,
          onShutdown(): void {
            shutdowns.push('repository');
          },
        };
      },
    },
  ],
  controllers: [UsersController],
})
class UsersModule {}

@Module({ providers: [{ token: ADMIN, useValue: { enabled: true } }] })
class AdminModule {}

@Module({ imports: [UsersModule, lazy(AdminModule)] })
class ReplAppModule {}

const PRIMARY = createToken<string>('db');
const REPLICA = createToken<string>('db');

@Module({
  providers: [
    { token: PRIMARY, useValue: 'primary' },
    { token: REPLICA, useValue: 'replica' },
  ],
})
class AmbiguousAppModule {}

interface Streams {
  readonly input: PassThrough;
  readonly output: PassThrough;
  readonly text: () => string;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  shutdowns.length = 0;
});

function streams(): Streams {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding('utf8');
  let text = '';
  output.on('data', (chunk: string) => {
    text += chunk;
  });
  return { input, output, text: () => text };
}

async function session(
  root: typeof ReplAppModule | typeof AmbiguousAppModule = ReplAppModule,
  options: {
    readonly historyPath?: string | null;
    readonly cwd?: string;
    readonly stderr?: (text: string) => void;
  } = {},
): Promise<{ readonly repl: ReplSession; readonly io: Streams }> {
  const io = streams();
  const repl = await createReplSession(root, {
    configPath: '/tmp/fixture/zmdb.config.ts',
    moduleSpec: './app.module.ts#ReplAppModule',
    cwd: options.cwd ?? process.cwd(),
    input: io.input,
    output: io.output,
    stderr: options.stderr ?? (() => {}),
    historyPath: options.historyPath ?? null,
    terminal: false,
  });
  return { repl, io };
}

async function waitFor(read: () => string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (read().includes(expected)) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${JSON.stringify(expected)} in ${JSON.stringify(read())}`);
}

describe('the zmdb REPL', () => {
  it('boots the container and resolves a provider in the repl scope', async () => {
    await using repl = (await session()).repl;

    expect(repl.scope.get(USERS).list()).toBe('users@fixture');
    expect(Object(repl.scope.get('USERS')).list()).toBe('users@fixture');
    expect(repl.scope.tokens).toEqual(['ADMIN', 'DATABASE', 'USERS']);
    expect(await repl.evaluate('get("USERS").list()')).toBe('users@fixture');

    const response = await repl.scope.request('/users/');
    expect(response).toMatchObject({ status: 200, body: { kind: 'text', value: '"users@fixture"' } });

    await repl.scope.load('AdminModule');
    expect(repl.scope.get('ADMIN')).toEqual({ enabled: true });
    expect(repl.scope.describe()).toContain('ReplAppModule');
  });

  it('does not start an HTTP listener', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    await using repl = (await session()).repl;

    expect(repl.app).toBe(repl.scope.app);
    expect(listen).not.toHaveBeenCalled();
  });

  it('the repl does not listen on a non-loopback address', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    const io = streams();
    let stderr = '';
    const code = await runCli(['repl', '--host', '0.0.0.0'], {
      stdinIsTTY: true,
      input: io.input,
      output: io.output,
      stderr: text => {
        stderr += text;
      },
    });

    expect(code).toBe(2);
    expect(stderr).toContain('unknown option "--host"');
    expect(listen).not.toHaveBeenCalled();
  });

  it('awaits and prints a promise result', async () => {
    await using _repl = (await session()).repl;
    const io = streams();
    const printing = await createReplSession(ReplAppModule, {
      configPath: '/tmp/fixture/zmdb.config.ts',
      moduleSpec: './app.module.ts#ReplAppModule',
      input: io.input,
      output: io.output,
      stderr: () => {},
      historyPath: null,
      terminal: false,
    });

    io.input.write('Promise.resolve(42)\n');
    await waitFor(io.text, '42');
    io.input.end('.exit\n');
    await printing.closed;
    await printing[Symbol.asyncDispose]();
    expect(io.text()).toContain('42');
  });

  it('releases connections on exit', async () => {
    const { repl, io } = await session();
    io.input.end('.exit\n');
    await repl.closed;
    await repl[Symbol.asyncDispose]();

    expect(shutdowns).toEqual(['repository', 'database']);
  });

  it('reports an ambiguous token description instead of choosing one', async () => {
    await using repl = (await session(AmbiguousAppModule)).repl;

    expect(() => repl.scope.get('db')).toThrow(/ambiguous \(2 distinct tokens\)/);
    expect(repl.scope.get(PRIMARY)).toBe('primary');
    expect(repl.scope.get(REPLICA)).toBe('replica');
  });

  it('prints the root, configuration boundary and available scope before the prompt', async () => {
    let banner = '';
    await using _repl = (
      await session(ReplAppModule, {
        stderr: text => {
          banner += text;
        },
      })
    ).repl;

    expect(banner).toContain('config: /tmp/fixture/zmdb.config.ts');
    expect(banner).toContain('dialect: application-owned');
    expect(banner).toContain('database: application-owned');
    expect(banner).toContain('module: ./app.module.ts#ReplAppModule (ReplAppModule)');
    expect(banner).toContain(
      'scope: app, container, get(tokenOrDescription), tokens, describe(), request(req), load(name)',
    );
  });

  it('writes private history outside the project and can disable it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zmdb-repl-'));
    temporaryDirectories.push(root);
    const project = join(root, 'project');
    const privateDirectory = join(root, 'private');
    const history = join(privateDirectory, 'history');
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'package.json'), '{}\n');
    writeFileSync(
      join(project, 'src', 'app.module.ts'),
      "export class AppModule { readonly note = 'empty application'; }\n",
    );

    const historyIo = streams();
    const historyRepl = await createReplSession(ReplAppModule, {
      configPath: '/tmp/fixture/zmdb.config.ts',
      moduleSpec: './app.module.ts#ReplAppModule',
      cwd: project,
      input: historyIo.input,
      output: historyIo.output,
      stderr: () => {},
      historyPath: history,
      terminal: true,
    });
    historyIo.input.end('21 * 2\n.exit\n');
    await historyRepl.closed;
    await historyRepl[Symbol.asyncDispose]();

    expect(readFileSync(history, 'utf8')).toContain('21 * 2');
    expect(statSync(history).mode & 0o777).toBe(0o600);
    expect(existsSync(join(project, '.zmdb_repl_history'))).toBe(false);

    const noHistoryIo = streams();
    const running = runCli(['repl', '--no-history'], {
      cwd: project,
      stdinIsTTY: true,
      input: noHistoryIo.input,
      output: noHistoryIo.output,
      stderr: () => {},
      environment: {},
      homeDirectory: privateDirectory,
    });
    await waitFor(noHistoryIo.text, 'zmdb> ');
    noHistoryIo.input.end('.exit\n');
    expect(await running).toBe(0);
    expect(existsSync(join(privateDirectory, '.zmdb_repl_history'))).toBe(false);
  });

  it('resolves a relative ZMDB_REPL_HISTORY against home rather than the project', () => {
    expect(replHistoryPath({ ZMDB_REPL_HISTORY: 'private/history' }, '/home/example')).toBe(
      '/home/example/private/history',
    );
    expect(replHistoryPath({}, '/home/example')).toBe('/home/example/.zmdb_repl_history');
  });

  it('refuses a history path inside the project tree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zmdb-repl-project-'));
    temporaryDirectories.push(root);
    writeFileSync(join(root, 'package.json'), '{}\n');

    await expect(session(ReplAppModule, { cwd: root, historyPath: join(root, 'history') })).rejects.toThrow(
      /must be outside the project tree/,
    );
  });
});
