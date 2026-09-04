import type { CompiledQuery } from '@zmdb/query-compiler';
import type { Driver } from '@zmdb/repository';
import type { CoreSchema } from '@zmdb/schema-core';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import { describe, expect, it } from 'vitest';
import { runCli } from 'zmdb/cli';

// Tests freeze for zmdb CLI SPEC §14 (#499, epic #497).
//
// RED ON PURPOSE. At HEAD 83cb5c25 neither future file named by #502 exists:
//
//   ../studio/index.js          — the server-rendered Fetch application
//   ./commands/studio.js        — the CLI/listener lifecycle
//
// The loaders below dynamically import those real future modules. A missing module is therefore an
// executable expected failure rather than a passing local implementation, while the file still
// typechecks and Vitest can count every assertion. The interfaces are an in-package test seam only;
// neither path is proposed as a public package export and there is no runtime `declare`.

interface StudioInput {
  readonly schemas: readonly CoreSchema<string>[];
  readonly driver: Driver;
}

interface StudioApp extends AsyncDisposable {
  fetch(request: Request): Promise<Response>;
}

interface StudioListenOptions {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly fetch: StudioApp['fetch'];
}

interface StudioListener extends AsyncDisposable {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly closed: Promise<void>;
}

interface StudioRuntime {
  createApp(input: StudioInput): StudioApp;
  listen(options: StudioListenOptions): Promise<StudioListener>;
}

interface RunStudioOptions {
  readonly port?: number;
  readonly runtime?: StudioRuntime;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

interface StudioAppModule {
  createStudioApp(input: StudioInput): StudioApp;
}

interface StudioCommandModule {
  runStudio(input: StudioInput, options?: RunStudioOptions): Promise<number>;
}

const STUDIO_APP_MODULE = '../studio/index.js';
const STUDIO_COMMAND_MODULE = './commands/studio.js';

function isStudioAppModule(value: unknown): value is StudioAppModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createStudioApp' in value &&
    typeof value.createStudioApp === 'function'
  );
}

function isStudioCommandModule(value: unknown): value is StudioCommandModule {
  return typeof value === 'object' && value !== null && 'runStudio' in value && typeof value.runStudio === 'function';
}

async function loadStudioApp(): Promise<StudioAppModule> {
  const loaded: unknown = await import(STUDIO_APP_MODULE);
  if (!isStudioAppModule(loaded)) {
    throw new Error('packages/zmdb/src/studio/index.ts does not export createStudioApp');
  }
  return loaded;
}

async function loadStudioCommand(): Promise<StudioCommandModule> {
  const loaded: unknown = await import(STUDIO_COMMAND_MODULE);
  if (!isStudioCommandModule(loaded)) {
    throw new Error('packages/zmdb/src/cli/commands/studio.ts does not export runStudio');
  }
  return loaded;
}

function column(
  name: string,
  sql: ColumnIR['sql'],
  extra: Partial<
    Pick<ColumnIR, 'primaryKey' | 'serial' | 'sensitive' | 'references' | 'nullable' | 'unique' | 'hasDefault'>
  > = {},
): ColumnIR {
  return {
    name,
    physicalName: name,
    sql,
    nullable: false,
    primaryKey: false,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    ...extra,
  };
}

const usersIr: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [
    column('id', 'integer', { primaryKey: true }),
    column('name', 'text'),
    column('passwordHash', 'text', { sensitive: true }),
  ],
  primaryKey: ['id'],
  relations: [{ name: 'posts', relation: 'oneToMany', target: 'posts', via: 'userId' }],
};

const postsIr: SchemaIR = {
  table: 'posts',
  physicalTable: 'posts',
  columns: [
    column('id', 'integer', { primaryKey: true }),
    column('userId', 'integer', { references: 'users.id' }),
    column('title', 'text'),
  ],
  primaryKey: ['id'],
  relations: [{ name: 'author', relation: 'manyToOne', target: 'users', via: 'userId' }],
};

const UsersSchema = schemaFromIR(usersIr);
const PostsSchema = schemaFromIR(postsIr);

const userRows = Array.from({ length: 75 }, (_unused, index) => ({
  id: index + 1,
  name: `User ${String(index + 1)}`,
  passwordHash: `secret-${String(index + 1)}`,
}));

const postRows = [
  { id: 10, userId: 1, title: 'First' },
  { id: 11, userId: 1, title: 'Second' },
  { id: 12, userId: 2, title: 'Other user' },
];

interface RecordingDriver extends Driver {
  readonly queries: CompiledQuery[];
}

function recordingDriver(): RecordingDriver {
  const queries: CompiledQuery[] = [];
  return {
    dialect: 'sqlite',
    queries,
    execute(query) {
      queries.push(query);
      const text = query.text.toLowerCase();
      const source = text.includes('posts') ? postRows : userRows;
      if (text.includes('count(')) {
        return Promise.resolve([{ count: source.length }]);
      }

      const whereValue = text.includes(' where ')
        ? query.parameters.find(value => typeof value === 'number')
        : undefined;
      const filtered =
        whereValue === undefined
          ? source
          : source.filter(row => {
              if (text.includes('userid') || text.includes('user_id')) {
                return 'userId' in row && row.userId === whereValue;
              }
              return row.id === whereValue;
            });
      const limit = Number(/\blimit\s+(\d+)/i.exec(query.text)?.[1] ?? filtered.length);
      const offset = Number(/\boffset\s+(\d+)/i.exec(query.text)?.[1] ?? 0);
      return Promise.resolve(filtered.slice(offset, offset + limit));
    },
  };
}

function input(driver: Driver = recordingDriver()): StudioInput {
  return { schemas: [UsersSchema, PostsSchema], driver };
}

async function withStudio<T>(driver: Driver, run: (app: StudioApp) => Promise<T>): Promise<T> {
  const { createStudioApp } = await loadStudioApp();
  const app = createStudioApp(input(driver));
  try {
    return await run(app);
  } finally {
    await app[Symbol.asyncDispose]();
  }
}

function tablePath(indexHtml: string, table: string): string {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`href=["']([^"']+)["'][^>]*>[^<]*${escaped}`, 'i').exec(indexHtml);
  if (match?.[1] === undefined) throw new Error(`studio index did not link the declared table "${table}"`);
  return match[1];
}

function withQuery(path: string, key: string, value: string): string {
  const url = new URL(path, 'http://127.0.0.1');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

describe('zmdb studio HTTP surface (frozen: CLI SPEC §14.1-§14.2)', () => {
  // Current actual for this block: ERR_MODULE_NOT_FOUND for ../studio/index.js.
  it.fails('shows only tables in the configured schema set', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const response = await app.fetch(new Request('http://127.0.0.1/'));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('users');
      expect(html).toContain('posts');
      expect(html).not.toContain('audit_log');
      expect(driver.queries).toEqual([]);
    });
  });

  it.fails('serves table rows read-only and rejects any write verb', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const index = await app.fetch(new Request('http://127.0.0.1/'));
      const path = tablePath(await index.text(), 'users');
      const read = await app.fetch(new Request(new URL(path, 'http://127.0.0.1')));
      const html = await read.text();
      expect(read.status).toBe(200);
      expect(html).toContain('User 1');

      const queriesAfterRead = driver.queries.length;
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await app.fetch(new Request(new URL(path, 'http://127.0.0.1'), { method }));
        expect(response.status, method).toBe(405);
        expect(response.headers.get('allow'), method).toBe('GET');
        expect(driver.queries, method).toHaveLength(queriesAfterRead);
      }
    });
  });

  it.fails('refuses a SQL string supplied by the client', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const index = await app.fetch(new Request('http://127.0.0.1/'));
      const path = tablePath(await index.text(), 'users');
      const response = await app.fetch(
        new Request(new URL(withQuery(path, 'sql', 'DROP TABLE users'), 'http://127.0.0.1')),
      );
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(text).toMatch(/sql.*not accepted|not accepted.*sql/i);
      expect(driver.queries).toEqual([]);
    });
  });

  it.fails('uses bounded offset pages instead of reading a whole table', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const index = await app.fetch(new Request('http://127.0.0.1/'));
      const path = tablePath(await index.text(), 'users');
      const first = await app.fetch(new Request(new URL(path, 'http://127.0.0.1')));
      const second = await app.fetch(new Request(new URL(withQuery(path, 'page', '2'), 'http://127.0.0.1')));
      const firstHtml = await first.text();
      const secondHtml = await second.text();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(firstHtml).not.toBe(secondHtml);
      expect(driver.queries.some(query => /\blimit\s+\d+/i.test(query.text))).toBe(true);
      expect(driver.queries.some(query => /\boffset\s+[1-9]\d*/i.test(query.text))).toBe(true);
    });
  });

  it.fails('omits a Sensitive column even when the driver returns it', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const index = await app.fetch(new Request('http://127.0.0.1/'));
      const path = tablePath(await index.text(), 'users');
      const response = await app.fetch(new Request(new URL(path, 'http://127.0.0.1')));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('User 1');
      expect(html).not.toContain('passwordHash');
      expect(html).not.toContain('secret-1');
    });
  });

  it.fails('serves server-rendered HTML without a browser asset build', async () => {
    await withStudio(recordingDriver(), async app => {
      const response = await app.fetch(new Request('http://127.0.0.1/'));
      const html = await response.text();
      expect(response.headers.get('content-type')).toMatch(/^text\/html\b/);
      expect(html).toMatch(/<!doctype html>|<html/i);
      expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
      expect(html).not.toMatch(/type=["']module["']/i);
    });
  });
});

describe('zmdb studio listener boundary (frozen: CLI SPEC §14.3)', () => {
  // Current actuals: runCli reports unknown command "studio", and importing
  // ./commands/studio.js reports ERR_MODULE_NOT_FOUND.
  it.fails('binds to loopback by default and refuses a non-loopback bind without the flag', async () => {
    let cliStdout = '';
    let cliStderr = '';
    const cliCode = await runCli(['studio', '--host', '0.0.0.0'], {
      stdinIsTTY: false,
      stdout: text => {
        cliStdout += text;
      },
      stderr: text => {
        cliStderr += text;
      },
    });

    const listenerActual: Record<string, unknown> = {};
    try {
      const { runStudio } = await loadStudioCommand();
      const events: string[] = [];
      const seen: StudioListenOptions[] = [];
      let output = '';
      const runtime: StudioRuntime = {
        createApp: () => ({
          fetch: () => Promise.resolve(new Response('ok')),
          [Symbol.asyncDispose]: () => {
            events.push('app:dispose');
            return Promise.resolve();
          },
        }),
        listen: options => {
          seen.push(options);
          return Promise.resolve({
            host: '127.0.0.1',
            port: 43_123,
            closed: Promise.resolve(),
            [Symbol.asyncDispose]: () => {
              events.push('listener:dispose');
              return Promise.resolve();
            },
          });
        },
      };

      listenerActual.code = await runStudio(input(), {
        runtime,
        stdout: text => {
          output += text;
        },
      });
      listenerActual.listen = seen.map(({ host, port }) => ({ host, port }));
      listenerActual.output = output;
      listenerActual.events = events;
    } catch (error) {
      listenerActual.error = error instanceof Error ? error.message : String(error);
    }

    expect({
      cli: { code: cliCode, stdout: cliStdout, stderr: cliStderr },
      listener: listenerActual,
    }).toEqual({
      cli: { code: 2, stdout: '', stderr: 'zmdb: unknown option "--host"\n' },
      listener: {
        code: 0,
        listen: [{ host: '127.0.0.1', port: 0 }],
        output: 'http://127.0.0.1:43123\n',
        events: ['listener:dispose', 'app:dispose'],
      },
    });
  });

  it.fails('keeps an explicit port on loopback and never retries a failed bind elsewhere', async () => {
    const { runStudio } = await loadStudioCommand();
    const seen: StudioListenOptions[] = [];
    const events: string[] = [];
    let stderr = '';
    const runtime: StudioRuntime = {
      createApp: () => ({
        fetch: () => Promise.resolve(new Response('ok')),
        [Symbol.asyncDispose]: () => {
          events.push('app:dispose');
          return Promise.resolve();
        },
      }),
      listen: options => {
        seen.push(options);
        return Promise.reject(new Error('EADDRINUSE fixture'));
      },
    };

    const code = await runStudio(input(), {
      port: 4545,
      runtime,
      stderr: text => {
        stderr += text;
      },
    });

    expect(code).toBe(1);
    expect(seen.map(({ host, port }) => ({ host, port }))).toEqual([{ host: '127.0.0.1', port: 4545 }]);
    expect(stderr).toContain('EADDRINUSE fixture');
    expect(events).toEqual(['app:dispose']);
  });
});
