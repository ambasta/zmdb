// @zmdb/web — router benchmark & perf verification (epic #317, spec ./SPEC.md).
// An honest microbench + an init-time-resolution probe proving route resolution
// does not re-read metadata per request. No `as` on the consumer surface.

import '@zmdb/app';
import type { ModuleClass } from '@zmdb/app/modules';
import { tracedDriver } from '@zmdb/app/observability';
import type { Observability } from '@zmdb/app/observability';
import type { CompiledQuery } from '@zmdb/query-compiler';

import { createApp } from '../app/index.js';
import { createRouter, type ResponseBody } from '../pipeline/index.js';
import { Controller, Get } from '../routing/index.js';
import { Version, type VersionStrategy } from '../versioning/index.js';
import { pathForVersion } from '../versioning/runtime.js';

/** A probe that counts reads of a class's Symbol.metadata. */
export interface MetadataReadCounter {
  count(): number;
  restore(): void;
}

/**
 * Instrument a class so reads of its `Symbol.metadata` are counted. Replaces the
 * own property with a counting getter over the original value; `restore` puts
 * the original descriptor back. Test-only helper for the regression guard.
 */
export function countMetadataReads(target: object): MetadataReadCounter {
  const original = Object.getOwnPropertyDescriptor(target, Symbol.metadata);
  const stored = original?.value;
  let reads = 0;
  Object.defineProperty(target, Symbol.metadata, {
    configurable: true,
    enumerable: original?.enumerable ?? false,
    get(): unknown {
      reads += 1;
      return stored;
    },
  });
  return {
    count: () => reads,
    restore: () => {
      if (original === undefined) {
        Reflect.deleteProperty(target, Symbol.metadata);
      } else {
        Object.defineProperty(target, Symbol.metadata, original);
      }
    },
  };
}

interface BenchmarkBaseOptions {
  readonly routes: number;
  readonly iters: number;
}

/** Options for the router microbench, including one exact versioned route table. */
export type BenchmarkOptions =
  | (BenchmarkBaseOptions & { readonly versioning?: undefined; readonly version?: undefined })
  | (BenchmarkBaseOptions & { readonly versioning: VersionStrategy; readonly version: string });

/** Honest microbench result — raw timings, no scoring. */
export interface BenchmarkResult {
  readonly iters: number;
  readonly totalMs: number;
  readonly opsPerSec: number;
}

/** The three tracing configurations measured by the operability benchmark. */
export type ObservabilityBenchmarkMode = 'off' | 'noop' | 'recording-exporter';

/** The independently timed observability hot paths. */
export type ObservabilityBenchmarkWorkload = 'request' | 'query';

/** Options for one independently orderable observability sample. */
export interface ObservabilityBenchmarkOptions {
  readonly mode: ObservabilityBenchmarkMode;
  readonly workload: ObservabilityBenchmarkWorkload;
  readonly iters: number;
  readonly observability?: Observability;
}

/** One raw workload timing. The checksum makes the loop's result observable. */
export interface ObservabilityBenchmarkResult extends BenchmarkResult {
  readonly mode: ObservabilityBenchmarkMode;
  readonly workload: ObservabilityBenchmarkWorkload;
  readonly checksum: number;
}

/** Measure repeated eager application creation with raw timings. */
export function benchmarkAppStartup(rootModule: ModuleClass, iters: number): BenchmarkResult {
  const start = performance.now();
  for (let index = 0; index < iters; index += 1) {
    createApp(rootModule);
  }
  const totalMs = performance.now() - start;
  const opsPerSec = totalMs > 0 ? (iters / totalMs) * 1000 : iters;
  return { iters, totalMs, opsPerSec };
}

/**
 * Build a router with `routes` GET routes and time `iters` `handle` calls
 * against a matching path. Returns raw timings — no averaging into a score.
 */
export async function benchmarkRouter(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const controller = makeController(options.routes, options.version);
  const router = createRouter(options.versioning === undefined ? {} : { versioning: options.versioning });
  router.register(controller);
  const routePath = `/bench/r${Math.max(0, options.routes - 1)}`;
  let path = routePath;
  let headers: Readonly<Record<string, string>> = {};
  if (options.versioning !== undefined) {
    if (options.versioning.kind === 'path') {
      path = pathForVersion(options.versioning.prefix, options.version, routePath);
    } else if (options.versioning.kind === 'header') {
      headers = { [options.versioning.name.toLowerCase()]: options.version };
    } else {
      headers = { accept: `application/json; ${options.versioning.key}=${options.version}` };
    }
  }

  const start = performance.now();
  for (let i = 0; i < options.iters; i += 1) {
    await router.handle({ method: 'GET', path, headers });
  }
  const totalMs = performance.now() - start;
  const opsPerSec = totalMs > 0 ? (options.iters / totalMs) * 1000 : options.iters;
  return { iters: options.iters, totalMs, opsPerSec };
}

/**
 * Measure one request or driver hot path under an injected tracing configuration.
 *
 * Tracer construction belongs to the top-level benchmark runner: this shipped
 * helper depends only on the framework's narrow observability port, never on an
 * SDK. The runner calls the same function for elapsed-time warmup and for every
 * raw sample, flushing an exporter only after this timer has stopped.
 */
export async function benchmarkObservability(
  options: ObservabilityBenchmarkOptions,
): Promise<ObservabilityBenchmarkResult> {
  return options.workload === 'request' ? benchmarkRequest(options) : benchmarkQuery(options);
}

async function benchmarkRequest(options: ObservabilityBenchmarkOptions): Promise<ObservabilityBenchmarkResult> {
  const observability = options.observability ?? {};
  const router = createRouter(observability);
  router.register(makeController(1));
  const request = Object.freeze({ method: 'GET', path: '/bench/r0', headers: Object.freeze({}) });

  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < options.iters; i += 1) {
    const response = await router.handle(request);
    checksum = (checksum + response.status + responseBodySize(response.body)) >>> 0;
  }
  return observabilityResult(options, performance.now() - start, checksum);
}

async function benchmarkQuery(options: ObservabilityBenchmarkOptions): Promise<ObservabilityBenchmarkResult> {
  const observability = options.observability ?? {};
  const driver = tracedDriver(
    {
      execute: query => {
        const id = query.parameters[0];
        return Promise.resolve(typeof id === 'number' && id % 2 === 0 ? TWO_ROWS : ONE_ROW);
      },
    },
    observability,
  );

  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < options.iters; i += 1) {
    const rows = await driver.execute(benchQuery(i));
    checksum = (checksum + rows.length) >>> 0;
  }
  return observabilityResult(options, performance.now() - start, checksum);
}

function observabilityResult(
  options: ObservabilityBenchmarkOptions,
  totalMs: number,
  checksum: number,
): ObservabilityBenchmarkResult {
  return {
    mode: options.mode,
    workload: options.workload,
    ...result(options.iters, totalMs),
    checksum,
  };
}

const QUERY_TELEMETRY: NonNullable<CompiledQuery['telemetry']> = Object.freeze({
  system: 'postgresql',
  operation: 'SELECT',
  collection: 'bench',
});

const BENCH_QUERIES: readonly CompiledQuery[] = Object.freeze(
  Array.from({ length: 8 }, (_, index): CompiledQuery =>
    Object.freeze({
      text: 'SELECT "id" FROM "bench" WHERE "id" = $1',
      parameters: Object.freeze([index + 1]),
      telemetry: QUERY_TELEMETRY,
    }),
  ),
);

const ONE_ROW: readonly Record<string, unknown>[] = Object.freeze([Object.freeze({ id: 1 })]);
const TWO_ROWS: readonly Record<string, unknown>[] = Object.freeze([
  Object.freeze({ id: 1 }),
  Object.freeze({ id: 2 }),
]);

function benchQuery(index: number): CompiledQuery {
  const query = BENCH_QUERIES[index % BENCH_QUERIES.length];
  if (query === undefined) {
    throw new Error('observability benchmark query pool is empty');
  }
  return query;
}

function responseBodySize(body: ResponseBody): number {
  if (typeof body.value === 'string') {
    return body.value.length;
  }
  if (body.value instanceof Uint8Array) {
    return body.value.byteLength;
  }
  return 'length' in body ? (body.length ?? 0) : 0;
}

// Build a controller instance with `count` GET routes /bench/r0../bench/r{n-1}.
// Defined via a factory so each benchmark gets a fresh class + metadata.
function makeController(count: number, version?: string): object {
  class BenchController {
    // Every route resolves to this one method, aliased under `count` names below. A benchmark
    // that allocated a fresh closure per route would be measuring that instead of the router.
    ok(): { ok: true } {
      return { ok: true };
    }
  }
  // `@Controller('/bench')` in decorator position instead, except that decorators are real
  // syntax rather than types, so a file containing one cannot be loaded by Node's type
  // stripping — and this package ships its `src`. A single decorator here was enough to make
  // `import '@zmdb/web'` a SyntaxError, because the root index re-exports this module. Applied
  // programmatically it costs a synthesised context; the routing decorators only ever touch
  // `context.metadata`, which is what makes the substitution exact.
  Controller('/bench')(BenchController, classContext(BenchController));
  if (version !== undefined) {
    Version(version)(BenchController, classContext(BenchController));
  }
  // Attach `count` routes by decorating dynamically-added methods. Since Stage-3
  // method decorators can't be applied dynamically, we register handlers on the
  // prototype and record routes through a single re-decoration pass: simplest is
  // to define a fixed handler and add route metadata via the Get decorator on
  // named prototype methods.
  const proto = BenchController.prototype;
  for (let i = 0; i < count; i += 1) {
    const name = `r${i}`;
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: proto.ok,
    });
    const decorate = Get(`/r${i}`);
    const context = methodContext(name, BenchController);
    decorate(readProtoMethod(proto, name), context);
  }
  return new BenchController();
}

function result(iters: number, totalMs: number): BenchmarkResult {
  return {
    iters,
    totalMs,
    opsPerSec: totalMs > 0 ? (iters / totalMs) * 1000 : iters,
  };
}

// A minimal ClassDecoratorContext, for the same reason. Controller reads `metadata` and nothing
// else; `name` and `addInitializer` are here to satisfy the type.
function classContext<T extends abstract new (...args: never[]) => unknown>(cls: T): ClassDecoratorContext<T> {
  return {
    kind: 'class',
    name: cls.name,
    metadata: ensureMetadata(cls),
    addInitializer: (): void => undefined,
  };
}

// A minimal ClassMethodDecoratorContext for programmatic decoration. The Get
// decorator only reads `name` + `metadata`; the rest satisfies the type.
function methodContext(name: string, cls: abstract new (...args: never[]) => unknown): ClassMethodDecoratorContext {
  const metadata = ensureMetadata(cls);
  const noop = (): void => undefined;
  return {
    kind: 'method',
    name,
    static: false,
    private: false,
    access: { has: () => true, get: obj => Reflect.get(Object(obj), name) },
    metadata,
    addInitializer: noop,
  };
}

function ensureMetadata(cls: abstract new (...args: never[]) => unknown): DecoratorMetadata {
  const existing = cls[Symbol.metadata];
  if (existing !== undefined && existing !== null) {
    return existing;
  }
  const created: DecoratorMetadata = Object.create(null);
  Object.defineProperty(cls, Symbol.metadata, {
    value: created,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return created;
}

// boundary: reading a just-defined prototype method by name to hand to the Get
// decorator; it is a function by construction (§2.1).
function readProtoMethod(proto: object, name: string): (...args: never[]) => unknown {
  const value = Reflect.get(proto, name);
  return value as (...args: never[]) => unknown;
}
