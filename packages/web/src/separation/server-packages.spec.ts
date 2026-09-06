import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { metadataOf } from '@zmdb/app';
import { describe, expect, it, vi } from 'vitest';

import {
  analyzeCoreServerBoundaries,
  CORE_SERVER_PACKAGES,
  findServerPackageCycle,
  PRODUCT_SERVER_EXPORTS,
} from '../../../../.github/scripts/verify-server-boundaries.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  withPackedBuildLock,
} from '../../../../fixtures/client-adapters/src/packed-project.js';
import { inspectServerCoreFixture } from '../../../../fixtures/consumer-server-core/verify-installed.mjs';
import { metadataOf as facadeMetadataOf } from '../../../zmdb/src/web.js';

const ROOT = process.cwd();
const CONSUMER = join(ROOT, 'fixtures', 'consumer-server-core', 'verify-installed.mjs');
const TYPESCRIPT_HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');
const APP_SPECIFIER = '@zmdb/app';
const JOBS_SPECIFIER = '@zmdb/jobs';
const WEB_SPECIFIER = '@zmdb/web';

type Constructor<T extends object = object> = new () => T;
type ModuleClass = abstract new (...args: never[]) => object;

interface FrozenModuleDef {
  readonly controllers?: readonly Constructor[];
  readonly commands?: readonly Constructor[];
}

type FrozenModuleDecorator = <T extends ModuleClass>(value: T, context: ClassDecoratorContext<T>) => void;

interface ApplicationExtensionContext {
  readonly container: object;
  readonly controllers: readonly object[];
  readonly commands: readonly object[];
  readonly observability: object;
}

interface ApplicationExtension {
  readonly name: string;
  start(context: ApplicationExtensionContext): void | Promise<void>;
  stop(options: { readonly graceMs: number }): void | Promise<void>;
}

interface ApplicationOptions {
  readonly extensions?: readonly ApplicationExtension[];
  readonly observability?: object;
  readonly graceMs?: number;
}

interface Application extends AsyncDisposable {
  readonly container: object;
  readonly lazy: readonly object[];
  init(): Promise<void>;
}

interface AppApi {
  Module(definition: FrozenModuleDef): FrozenModuleDecorator;
  createApplication(root: ModuleClass, options?: ApplicationOptions): Application;
}

type FrozenClassDecorator = <T extends Constructor>(value: T, context: ClassDecoratorContext<T>) => void;
type FrozenMethodDecorator = <This, Args extends unknown[], Result>(
  value: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void;

interface WebRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface WebResponse {
  readonly status: number;
}

interface WebApplication extends Application {
  handle(request: WebRequest): Promise<WebResponse>;
}

interface WebApi {
  Controller(path: string): FrozenClassDecorator;
  Get(path?: string): FrozenMethodDecorator;
  createApp(root: ModuleClass, options?: ApplicationOptions): WebApplication;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isAppApi(value: unknown): value is AppApi {
  return isRecord(value) && typeof value.Module === 'function' && typeof value.createApplication === 'function';
}

function isWebApi(value: unknown): value is WebApi {
  return (
    isRecord(value) &&
    typeof value.Controller === 'function' &&
    typeof value.Get === 'function' &&
    typeof value.createApp === 'function'
  );
}

async function loadModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

async function loadAppApi(): Promise<AppApi> {
  const value = await loadModule(APP_SPECIFIER);
  if (!isAppApi(value)) throw new Error('@zmdb/app omitted Module or createApplication');
  return value;
}

async function loadWebApi(): Promise<WebApi> {
  const value = await loadModule(WEB_SPECIFIER);
  if (!isWebApi(value)) throw new Error('@zmdb/web omitted Controller, Get, or createApp');
  return value;
}

function moduleRecord(value: unknown, specifier: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${specifier} did not evaluate to a module record`);
  return value;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, resolve: release };
}

function capturedError(action: () => PromiseLike<void>): Promise<unknown> {
  return Promise.resolve(action()).then(
    () => undefined,
    error => error,
  );
}

let measuredBoundaries: ReturnType<typeof analyzeCoreServerBoundaries> | undefined;
function coreBoundaries(): ReturnType<typeof analyzeCoreServerBoundaries> {
  measuredBoundaries ??= analyzeCoreServerBoundaries(ROOT);
  return measuredBoundaries;
}

describe('core server package boundaries (#646)', () => {
  it('keeps @zmdb/app free of HTTP and job exports', () => {
    expect(coreBoundaries().packageProblems.get('@zmdb/app')).toEqual([]);
  });

  it('keeps @zmdb/web free of jobs and optional integrations', () => {
    expect(coreBoundaries().packageProblems.get('@zmdb/web')).toEqual([]);
  });

  it('keeps @zmdb/jobs free of HTTP and third-party peers', () => {
    expect(coreBoundaries().packageProblems.get('@zmdb/jobs')).toEqual([]);
  });

  it('keeps the server package graph acyclic', () => {
    const report = coreBoundaries();
    expect(report.graphProblems).toEqual([]);
    expect(findServerPackageCycle(report.edges)).toBeNull();
    expect(
      findServerPackageCycle([
        ['@zmdb/app', '@zmdb/web'],
        ['@zmdb/web', '@zmdb/app'],
      ]),
    ).toEqual(['@zmdb/app', '@zmdb/web', '@zmdb/app']);
  });

  it('freezes every direct core edge and all 32 default product facade subpaths', () => {
    expect(CORE_SERVER_PACKAGES).toEqual([
      {
        name: '@zmdb/app',
        dir: 'app',
        dependencies: {
          '@zmdb/aot-validator': 'workspace:^',
          '@zmdb/query-compiler': 'workspace:^',
          '@zmdb/repository': 'workspace:^',
          '@zmdb/schema-core': 'workspace:^',
        },
        exports: [
          '.',
          './commands',
          './cqrs',
          './data',
          './di',
          './events',
          './health',
          './lifecycle',
          './messaging',
          './modules',
          './observability',
          './state',
        ],
        forbiddenPackages: ['@zmdb/jobs', '@zmdb/web'],
        forbiddenExports: [],
      },
      {
        name: '@zmdb/web',
        dir: 'web',
        dependencies: {
          '@zmdb/aot-validator': 'workspace:^',
          '@zmdb/app': 'workspace:^',
          '@zmdb/schema-core': 'workspace:^',
        },
        buildTimePeers: {
          typescript: '>=7.0.0',
        },
        exports: [
          '.',
          './app',
          './compression',
          './context',
          './contract',
          './contract/compiler',
          './csrf',
          './data',
          './devtools',
          './dto-pipes',
          './gateways',
          './health',
          './middleware',
          './openapi',
          './pipeline',
          './routing',
          './static',
          './testing',
          './upload',
          './versioning',
        ],
        buildTimeExports: ['./contract/compiler'],
        forbiddenPackages: ['@zmdb/jobs'],
        forbiddenExports: [
          './cli',
          './cqrs',
          './di',
          './events',
          './microservices',
          './modules',
          './observability',
          './queues',
          './queues/backends/memory',
          './schedule',
          './state',
        ],
      },
      {
        name: '@zmdb/jobs',
        dir: 'jobs',
        dependencies: {
          '@zmdb/app': 'workspace:^',
          '@zmdb/query-compiler': 'workspace:^',
          '@zmdb/repository': 'workspace:^',
          '@zmdb/sqlite': 'workspace:^',
        },
        exports: ['.', './memory', './schedule'],
        forbiddenPackages: ['@zmdb/web'],
        forbiddenExports: [],
      },
    ]);
    expect(PRODUCT_SERVER_EXPORTS).toHaveLength(32);
    expect(new Set(PRODUCT_SERVER_EXPORTS).size).toBe(32);
    expect(PRODUCT_SERVER_EXPORTS.filter(subpath => subpath === './jobs' || subpath.startsWith('./jobs/'))).toEqual([]);
  });

  it.each([APP_SPECIFIER])('imports %s from its dedicated package', specifier => {
    const result = spawnSync(
      process.execPath,
      ['--import', TYPESCRIPT_HOOK, '--input-type=module', '--eval', `await import(${JSON.stringify(specifier)})`],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([JOBS_SPECIFIER])('imports %s from its dedicated package', specifier => {
    const result = spawnSync(
      process.execPath,
      ['--import', TYPESCRIPT_HOOK, '--input-type=module', '--eval', `await import(${JSON.stringify(specifier)})`],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('keeps the installed consumer free of workspace aliases and declaration shortcuts', () => {
    expect(inspectServerCoreFixture()).toEqual([]);
  });

  it('a plain zmdb install requires no third-party server peer', () => {
    const output = execFileSync(process.execPath, [CONSUMER, '--plain'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(output).toMatch(/0 optional server packages or peers/);
  }, 180_000);

  it(
    'a default installed consumer serves HTTP and runs a command without jobs',
    () => {
      const result = withPackedBuildLock(ROOT, () =>
        spawnSync(process.execPath, [CONSUMER, '--target'], {
          cwd: ROOT,
          encoding: 'utf8',
        }),
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('"facadePairs":32');
      expect(result.stdout).toContain('"httpStatus":200');
      expect(result.stdout).toContain('"commandExit":0');
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});

describe('@zmdb/app deterministic lifecycle (#646)', () => {
  it('starts hooks and extensions in order, then stops them in reverse order', async () => {
    const api = await loadAppApi();
    const log: string[] = [];
    const contexts: ApplicationExtensionContext[] = [];

    class First {
      onModuleInit(): void {
        log.push('init:first');
      }
      onApplicationBootstrap(): void {
        log.push('bootstrap:first');
      }
      onShutdown(): void {
        log.push('shutdown:first');
      }
    }
    class Second {
      onModuleInit(): void {
        log.push('init:second');
      }
      onApplicationBootstrap(): void {
        log.push('bootstrap:second');
      }
      onShutdown(): void {
        log.push('shutdown:second');
      }
    }
    @api.Module({ controllers: [First, Second] })
    class Root {}

    const extension = (name: string): ApplicationExtension => ({
      name,
      start(context) {
        contexts.push(context);
        log.push(`start:${name}`);
      },
      stop() {
        log.push(`stop:${name}`);
      },
    });
    const app = api.createApplication(Root, { extensions: [extension('a'), extension('b')] });
    await app.init();

    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toBe(contexts[0]);
    expect(contexts[0]?.controllers).toHaveLength(2);
    expect(log).toEqual(['init:first', 'init:second', 'bootstrap:first', 'bootstrap:second', 'start:a', 'start:b']);

    await app[Symbol.asyncDispose]();
    expect(log.slice(-4)).toEqual(['stop:b', 'stop:a', 'shutdown:second', 'shutdown:first']);
  });

  it('returns one promise to concurrent init and dispose callers', async () => {
    const api = await loadAppApi();
    @api.Module({ controllers: [] })
    class Root {}
    const app = api.createApplication(Root);

    const firstInit = app.init();
    expect(app.init()).toBe(firstInit);
    await firstInit;

    const firstDispose = app[Symbol.asyncDispose]();
    expect(app[Symbol.asyncDispose]()).toBe(firstDispose);
    await firstDispose;
  });

  it('rolls back the partially started extension itself and preserves the startup error', async () => {
    const api = await loadAppApi();
    const log: string[] = [];
    const startupError = new Error('extension b failed');
    @api.Module({ controllers: [] })
    class Root {}
    const app = api.createApplication(Root, {
      extensions: [
        {
          name: 'a',
          start() {
            log.push('start:a');
          },
          stop() {
            log.push('stop:a');
          },
        },
        {
          name: 'b',
          start() {
            log.push('start:b');
            throw startupError;
          },
          stop() {
            log.push('stop:b');
          },
        },
      ],
    });

    expect(await capturedError(() => app.init())).toBe(startupError);
    expect(log).toEqual(['start:a', 'start:b', 'stop:b', 'stop:a']);
  });

  it('orders startup and cleanup failures in one AggregateError', async () => {
    const api = await loadAppApi();
    const startupError = new Error('startup');
    const stopB = new Error('stop b');
    const stopA = new Error('stop a');
    const shutdown = new Error('shutdown');
    class Provider {
      onShutdown(): void {
        throw shutdown;
      }
    }
    @api.Module({ controllers: [Provider] })
    class Root {}
    const app = api.createApplication(Root, {
      extensions: [
        {
          name: 'a',
          start() {},
          stop() {
            throw stopA;
          },
        },
        {
          name: 'b',
          start() {
            throw startupError;
          },
          stop() {
            throw stopB;
          },
        },
      ],
    });

    const error = await capturedError(() => app.init());
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw new Error('startup cleanup did not aggregate failures');
    expect(error.cause).toBe(startupError);
    expect(error.errors).toEqual([startupError, stopB, stopA, shutdown]);
  });

  it('preserves one shutdown error while still attempting every eligible hook', async () => {
    const api = await loadAppApi();
    const log: string[] = [];
    const stopError = new Error('stop b');
    class Provider {
      onShutdown(): void {
        log.push('shutdown');
      }
    }
    @api.Module({ controllers: [Provider] })
    class Root {}
    const app = api.createApplication(Root, {
      extensions: [
        {
          name: 'a',
          start() {},
          stop() {
            log.push('stop:a');
          },
        },
        {
          name: 'b',
          start() {},
          stop() {
            log.push('stop:b');
            throw stopError;
          },
        },
      ],
    });
    await app.init();

    expect(await capturedError(() => app[Symbol.asyncDispose]())).toBe(stopError);
    expect(log).toEqual(['stop:b', 'stop:a', 'shutdown']);
  });

  it('orders multiple shutdown failures by reverse extension then reverse construction order', async () => {
    const api = await loadAppApi();
    const stopA = new Error('stop a');
    const stopB = new Error('stop b');
    const shutdownA = new Error('shutdown a');
    const shutdownB = new Error('shutdown b');
    class First {
      onShutdown(): void {
        throw shutdownA;
      }
    }
    class Second {
      onShutdown(): void {
        throw shutdownB;
      }
    }
    @api.Module({ controllers: [First, Second] })
    class Root {}
    const app = api.createApplication(Root, {
      extensions: [
        { name: 'a', start() {}, stop: () => Promise.reject(stopA) },
        { name: 'b', start() {}, stop: () => Promise.reject(stopB) },
      ],
    });
    await app.init();

    const error = await capturedError(() => app[Symbol.asyncDispose]());
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw new Error('shutdown did not aggregate failures');
    expect(error.errors).toEqual([stopB, stopA, shutdownB, shutdownA]);
  });

  it('shares one application-wide grace deadline across extension stops', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));
    try {
      const api = await loadAppApi();
      const observed: { readonly name: string; readonly graceMs: number }[] = [];
      @api.Module({ controllers: [] })
      class Root {}
      const app = api.createApplication(Root, {
        graceMs: 100,
        extensions: [
          {
            name: 'a',
            start() {},
            stop({ graceMs }) {
              observed.push({ name: 'a', graceMs });
            },
          },
          {
            name: 'b',
            start() {},
            stop({ graceMs }) {
              observed.push({ name: 'b', graceMs });
              vi.advanceTimersByTime(30);
            },
          },
        ],
      });
      await app.init();
      await app[Symbol.asyncDispose]();
      expect(observed).toEqual([
        { name: 'b', graceMs: 100 },
        { name: 'a', graceMs: 70 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes constructed instances without starting extensions when init never ran', async () => {
    const api = await loadAppApi();
    const log: string[] = [];
    class Provider {
      onShutdown(): void {
        log.push('shutdown');
      }
    }
    @api.Module({ controllers: [Provider] })
    class Root {}
    const app = api.createApplication(Root, {
      extensions: [
        {
          name: 'unused',
          start() {
            log.push('start');
          },
          stop() {
            log.push('stop');
          },
        },
      ],
    });

    await app[Symbol.asyncDispose]();
    expect(log).toEqual(['shutdown']);
  });

  it('waits for startup before one disposal path completes', async () => {
    const api = await loadAppApi();
    const started = deferred();
    const release = deferred();
    const log: string[] = [];
    class Provider {
      onShutdown(): void {
        log.push('shutdown');
      }
    }
    @api.Module({ controllers: [Provider] })
    class Root {}
    const app = api.createApplication(Root, {
      extensions: [
        {
          name: 'slow',
          async start() {
            log.push('start');
            started.resolve();
            await release.promise;
            log.push('started');
          },
          stop() {
            log.push('stop');
          },
        },
      ],
    });

    const initializing = app.init();
    await started.promise;
    const disposing = app[Symbol.asyncDispose]();
    await Promise.resolve();
    expect(log).toEqual(['start']);
    release.resolve();
    await Promise.all([initializing, disposing]);
    expect(log).toEqual(['start', 'started', 'stop', 'shutdown']);
  });

  it('keeps failed initialization terminal and never reopens an extension', async () => {
    const api = await loadAppApi();
    const startupError = new Error('terminal startup');
    let starts = 0;
    @api.Module({ controllers: [] })
    class Root {}
    const app = api.createApplication(Root, {
      extensions: [
        {
          name: 'broken',
          start() {
            starts += 1;
            throw startupError;
          },
          stop() {},
        },
      ],
    });

    const first = app.init();
    expect(app.init()).toBe(first);
    expect(await capturedError(() => first)).toBe(startupError);
    expect(await capturedError(() => app.init())).toBe(startupError);
    expect(starts).toBe(1);
  });

  it('rejects invalid grace and extension names synchronously before construction hooks', async () => {
    const api = await loadAppApi();
    @api.Module({ controllers: [] })
    class Root {}

    expect(() => api.createApplication(Root, { graceMs: 0 })).toThrow('@zmdb/app: graceMs must be a positive integer');
    expect(() => api.createApplication(Root, { extensions: [{ name: '', start() {}, stop() {} }] })).toThrow(
      '@zmdb/app: an extension name cannot be empty',
    );
    expect(() =>
      api.createApplication(Root, {
        extensions: [
          { name: 'duplicate', start() {}, stop() {} },
          { name: 'duplicate', start() {}, stop() {} },
        ],
      }),
    ).toThrow('@zmdb/app: duplicate extension name "duplicate"');
  });

  it('rejects init after shutdown begins with the app-owned error prefix', async () => {
    const api = await loadAppApi();
    @api.Module({ controllers: [] })
    class Root {}
    const app = api.createApplication(Root);
    await app[Symbol.asyncDispose]();
    await expect(app.init()).rejects.toThrow('@zmdb/app: application is shutting down');
  });
});

describe('server facade and reflection identity (#646)', () => {
  it('uses one Stage-3 metadata reader through the current direct and facade entries', () => {
    const metadata = Object.freeze({ fixture: true });
    const carrier = Object.defineProperty({}, Symbol.metadata, { value: metadata });

    expect(facadeMetadataOf).toBe(metadataOf);
    expect(metadataOf(carrier)).toBe(metadata);
    expect(facadeMetadataOf(carrier)).toBe(metadata);
  });

  it('preserves app concern-facade and curated-root runtime identity', async () => {
    const [appValue, appFacadeValue, productValue] = await Promise.all([
      loadModule(APP_SPECIFIER),
      loadModule('zmdb/app'),
      loadModule('zmdb'),
    ]);
    const app = moduleRecord(appValue, APP_SPECIFIER);
    const appFacade = moduleRecord(appFacadeValue, 'zmdb/app');
    const product = moduleRecord(productValue, 'zmdb');

    for (const name of Object.keys(app)) {
      expect(appFacade[name], `zmdb/app#${name}`).toBe(app[name]);
    }
    for (const name of ['Container', 'Module', 'createApplication', 'createToken']) {
      expect(product[name], `zmdb#${name}`).toBe(app[name]);
    }
  });

  it('zmdb/web exports app and HTTP values by identity', async () => {
    const [appValue, webValue, webFacadeValue, productValue] = await Promise.all([
      loadModule(APP_SPECIFIER),
      loadModule(WEB_SPECIFIER),
      loadModule('zmdb/web'),
      loadModule('zmdb'),
    ]);
    const app = moduleRecord(appValue, APP_SPECIFIER);
    const web = moduleRecord(webValue, WEB_SPECIFIER);
    const facade = moduleRecord(webFacadeValue, 'zmdb/web');
    const product = moduleRecord(productValue, 'zmdb');

    for (const name of Object.keys(app)) {
      expect(facade[name], `zmdb/web#${name}`).toBe(app[name]);
    }
    for (const name of Object.keys(web)) {
      expect(facade[name], `zmdb/web#${name}`).toBe(web[name]);
    }
    for (const name of ['Controller', 'Get', 'createApp']) {
      expect(product[name], `zmdb#${name}`).toBe(web[name]);
    }
  });

  it('keeps jobs package-owned and absent from the default product facade', async () => {
    const jobs = moduleRecord(await loadModule(JOBS_SPECIFIER), JOBS_SPECIFIER);
    expect(typeof jobs.createQueue).toBe('function');
    await expect(loadModule('zmdb/jobs')).rejects.toThrow(/not exported/);
  });

  it('keeps extension dispatch off the HTTP request hot path and shares controller identity', async () => {
    const [appApi, webApi] = await Promise.all([loadAppApi(), loadWebApi()]);
    const log: string[] = [];
    const handled: object[] = [];
    let context: ApplicationExtensionContext | undefined;

    @webApi.Controller('/ping')
    class Ping {
      @webApi.Get()
      ping(): string {
        handled.push(this);
        return 'ok';
      }
    }
    @appApi.Module({ controllers: [Ping] })
    class Root {}

    const server = webApi.createApp(Root, {
      extensions: [
        {
          name: 'fixture',
          start(value) {
            context = value;
            log.push('start');
          },
          stop() {
            log.push('stop');
          },
        },
      ],
    });
    await server.init();
    expect((await server.handle({ method: 'GET', path: '/ping', headers: {} })).status).toBe(200);
    expect((await server.handle({ method: 'GET', path: '/ping', headers: {} })).status).toBe(200);
    expect(log).toEqual(['start']);
    expect(handled).toHaveLength(2);
    expect(handled[1]).toBe(handled[0]);
    expect(context?.controllers).toContain(handled[0]);

    await server[Symbol.asyncDispose]();
    expect(log).toEqual(['start', 'stop']);
  });
});
