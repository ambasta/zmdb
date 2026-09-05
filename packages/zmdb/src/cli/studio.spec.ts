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
  listenStudio(options: StudioListenOptions): Promise<StudioListener>;
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
  return (
    typeof value === 'object' &&
    value !== null &&
    'runStudio' in value &&
    typeof value.runStudio === 'function' &&
    'listenStudio' in value &&
    typeof value.listenStudio === 'function'
  );
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
  foreignKeys: [],
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
  foreignKeys: [],
};

const UsersSchema = schemaFromIR(usersIr);
const PostsSchema = schemaFromIR(postsIr);
const SensitiveKeyUsersSchema = schemaFromIR({
  ...usersIr,
  columns: usersIr.columns.map(candidate => (candidate.name === 'id' ? { ...candidate, sensitive: true } : candidate)),
});
const PeopleSchema = schemaFromIR({
  table: 'people',
  physicalTable: 'app_people',
  columns: [
    { ...column('id', 'integer', { primaryKey: true }), physicalName: 'person_id' },
    { ...column('name', 'text'), physicalName: 'display_name' },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
});
const TenantUsersSchema = schemaFromIR({
  table: 'tenantUsers',
  physicalTable: 'tenant_users',
  columns: [
    { ...column('tenantId', 'text', { primaryKey: true }), physicalName: 'tenant_id' },
    { ...column('id', 'integer', { primaryKey: true }), physicalName: 'user_id' },
    column('name', 'text'),
  ],
  primaryKey: ['tenantId', 'id'],
  relations: [{ name: 'posts', relation: 'oneToMany', target: 'tenantPosts', via: 'tenantId,userId' }],
  foreignKeys: [],
});
const TenantPostsSchema = schemaFromIR({
  table: 'tenantPosts',
  physicalTable: 'tenant_posts',
  columns: [
    column('id', 'integer', { primaryKey: true }),
    { ...column('tenantId', 'text', { references: 'tenantUsers.tenantId' }), physicalName: 'tenant_id' },
    { ...column('userId', 'integer', { references: 'tenantUsers.id' }), physicalName: 'user_id' },
    column('title', 'text'),
  ],
  primaryKey: ['id'],
  relations: [{ name: 'author', relation: 'manyToOne', target: 'tenantUsers', via: 'tenantId,userId' }],
  foreignKeys: [],
});

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
      if (text.includes('count(')) {
        return Promise.resolve([{ count: filtered.length }]);
      }
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

function linkedPath(html: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(html);
  if (match?.[1] === undefined) throw new Error(`studio page did not link ${label}`);
  return match[1];
}

describe('zmdb studio HTTP surface (frozen: CLI SPEC §14.1-§14.2)', () => {
  it('shows only tables in the configured schema set', async () => {
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

  it('keeps declared names in the browser and physical names inside compiled SQL', async () => {
    const queries: CompiledQuery[] = [];
    const driver: Driver = {
      dialect: 'sqlite',
      execute(query) {
        queries.push(query);
        return Promise.resolve(
          query.text.toLowerCase().includes('count(') ? [{ count: 1 }] : [{ person_id: 1, display_name: 'Ada' }],
        );
      },
    };
    const { createStudioApp } = await loadStudioApp();
    await using app = createStudioApp({ schemas: [PeopleSchema], driver });
    const index = await app.fetch(new Request('http://127.0.0.1/'));
    const page = await app.fetch(new Request(new URL(tablePath(await index.text(), 'people'), 'http://127.0.0.1')));
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain('Ada');
    expect(html).toContain('name');
    expect(html).not.toContain('display_name');
    expect(queries.every(query => query.text.includes('"app_people"'))).toBe(true);
    expect(queries.some(query => query.text.includes('"display_name"'))).toBe(true);
  });

  it('serves table rows read-only and rejects any write verb', async () => {
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

  it('refuses a SQL string supplied by the client', async () => {
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

  it('uses bounded offset pages instead of reading a whole table', async () => {
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

  it('omits a Sensitive column even when the driver returns it', async () => {
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

  it('keeps a Sensitive primary key out of pagination links', async () => {
    const { createStudioApp } = await loadStudioApp();
    await using app = createStudioApp({ schemas: [SensitiveKeyUsersSchema], driver: recordingDriver() });
    const first = await app.fetch(new Request('http://127.0.0.1/tables/users?pageSize=1'));
    const nextPath = linkedPath(await first.text(), /rel=["']next["'] href=["']([^"']+)["']/i, 'the next page');
    const nextUrl = new URL(nextPath.replaceAll('&amp;', '&'), 'http://127.0.0.1');
    const second = await app.fetch(new Request(nextUrl));

    expect(first.status).toBe(200);
    expect(nextUrl.searchParams.get('orderBy')).toBe('name');
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('User 2');
  });

  it('serves server-rendered HTML without a browser asset build', async () => {
    await withStudio(recordingDriver(), async app => {
      const response = await app.fetch(new Request('http://127.0.0.1/'));
      const html = await response.text();
      expect(response.headers.get('content-type')).toMatch(/^text\/html\b/);
      expect(html).toMatch(/<!doctype html>|<html/i);
      expect(html).toMatch(/local raw-data viewer/i);
      expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
      expect(html).not.toMatch(/type=["']module["']/i);
    });
  });

  it('rejects every non-GET verb at the router level', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const response = await app.fetch(new Request('http://127.0.0.1/tables/users', { method }));
        expect(response.status, method).toBe(405);
        expect(response.headers.get('allow'), method).toBe('GET');
      }
      expect(driver.queries).toEqual([]);
    });
  });

  it('caps the number of rows returned regardless of the requested page size', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const response = await app.fetch(new Request('http://127.0.0.1/tables/users?pageSize=10000'));
      const html = await response.text();
      const rowQuery = driver.queries.find(query => /\blimit\s+\d+/i.test(query.text));
      const limit = Number(/\blimit\s+(\d+)/i.exec(rowQuery?.text ?? '')?.[1]);

      expect(response.status).toBe(200);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(50);
      expect(html).toContain(`User ${String(limit)}`);
      expect(html).not.toContain(`User ${String(limit + 1)}`);
    });
  });

  it('refuses a table name that is not in the configured schema set', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const response = await app.fetch(new Request('http://127.0.0.1/tables/audit_log'));
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/undeclared table.*audit_log|audit_log.*undeclared table/i);
      expect(driver.queries).toEqual([]);
    });
  });

  it('lists tables, pages rows, gets one row and follows a declared relation', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const index = await app.fetch(new Request('http://127.0.0.1/'));
      const page = await app.fetch(new Request(new URL(tablePath(await index.text(), 'users'), 'http://127.0.0.1')));
      const rowPath = linkedPath(await page.text(), /href=["']([^"']+\/rows\/[^"']+)["']/i, 'the first row');
      const row = await app.fetch(new Request(new URL(rowPath, 'http://127.0.0.1')));
      const relationPath = linkedPath(
        await row.text(),
        /href=["']([^"']+\/relations\/posts[^"']*)["']/i,
        'the posts relation',
      );
      const relation = await app.fetch(new Request(new URL(relationPath, 'http://127.0.0.1')));
      const html = await relation.text();

      expect(page.status).toBe(200);
      expect(row.status).toBe(200);
      expect(relation.status).toBe(200);
      expect(html).toContain('First');
      expect(html).toContain('Second');
      expect(html).not.toContain('Other user');
    });
  });

  it('follows every column of a composite parent relation', async () => {
    const queries: CompiledQuery[] = [];
    const parent = { tenant_id: 't1', user_id: 1, name: 'Tenant one user' };
    const posts = [
      { id: 10, tenant_id: 't1', user_id: 1, title: 'Right tenant' },
      { id: 11, tenant_id: 't2', user_id: 1, title: 'Wrong tenant' },
    ];
    const driver: Driver = {
      dialect: 'sqlite',
      execute(query) {
        queries.push(query);
        if (query.text.includes('tenant_users')) return Promise.resolve([parent]);
        const related = posts.filter(
          post => post.tenant_id === query.parameters[0] && post.user_id === query.parameters[1],
        );
        if (query.text.includes('COUNT(')) return Promise.resolve([{ count: related.length }]);
        return Promise.resolve(related);
      },
    };
    const { createStudioApp } = await loadStudioApp();
    await using app = createStudioApp({ schemas: [TenantUsersSchema, TenantPostsSchema], driver });
    const key = encodeURIComponent(JSON.stringify({ tenantId: 't1', id: 1 }));
    const response = await app.fetch(new Request(`http://127.0.0.1/tables/tenantUsers/rows/${key}/relations/posts`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Right tenant');
    expect(html).not.toContain('Wrong tenant');
    const relationQueries = queries.map(query => query.text).filter(text => text.includes('tenant_posts'));
    expect(relationQueries).toHaveLength(2);
    expect(relationQueries).toEqual(
      expect.arrayContaining([
        'SELECT COUNT(*) AS "count" FROM "tenant_posts" WHERE "tenant_id" = ? AND "user_id" = ?',
        'SELECT "id", "tenant_id", "user_id", "title" FROM "tenant_posts" WHERE "tenant_id" = ? AND "user_id" = ? ORDER BY "id" ASC LIMIT 25 OFFSET 0',
      ]),
    );
  });

  it('refuses an undeclared sort column before executing a query', async () => {
    const driver = recordingDriver();
    await withStudio(driver, async app => {
      const response = await app.fetch(
        new Request('http://127.0.0.1/tables/users?orderBy=createdByClient&direction=desc'),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/undeclared column.*createdByClient|createdByClient.*undeclared column/i);
      expect(driver.queries).toEqual([]);
    });
  });
});

describe('zmdb studio listener boundary (frozen: CLI SPEC §14.3)', () => {
  it('binds to loopback by default and refuses a non-loopback bind without the flag', async () => {
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

  it('keeps an explicit port on loopback and never retries a failed bind elsewhere', async () => {
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

  it('the concrete listener opens only a loopback socket', async () => {
    const { listenStudio } = await loadStudioCommand();
    await using listener = await listenStudio({
      host: '127.0.0.1',
      port: 0,
      fetch: () =>
        Promise.resolve(
          new Response('<!doctype html><title>loopback</title>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        ),
    });

    const response = await fetch(`http://${listener.host}:${String(listener.port)}/`);
    expect(listener.host).toBe('127.0.0.1');
    expect(listener.port).toBeGreaterThan(0);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('loopback');
  });
});
