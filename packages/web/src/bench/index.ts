// @zmdb/web — router benchmark & perf verification (epic #317, spec ./SPEC.md).
// An honest microbench + an init-time-resolution probe proving route resolution
// does not re-read metadata per request. No `as` on the consumer surface.

import '../polyfill.js';
import { createRouter } from '../pipeline/index.js';
import { Controller, Get } from '../routing/index.js';

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

/** Options for the router microbench. */
export interface BenchmarkOptions {
  readonly routes: number;
  readonly iters: number;
}

/** Honest microbench result — raw timings, no scoring. */
export interface BenchmarkResult {
  readonly iters: number;
  readonly totalMs: number;
  readonly opsPerSec: number;
}

/**
 * Build a router with `routes` GET routes and time `iters` `handle` calls
 * against a matching path. Returns raw timings — no averaging into a score.
 */
export async function benchmarkRouter(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const controller = makeController(options.routes);
  const router = createRouter();
  router.register(controller);
  const path = `/bench/r${Math.max(0, options.routes - 1)}`;

  const start = performance.now();
  for (let i = 0; i < options.iters; i += 1) {
    await router.handle({ method: 'GET', path, headers: {} });
  }
  const totalMs = performance.now() - start;
  const opsPerSec = totalMs > 0 ? (options.iters / totalMs) * 1000 : options.iters;
  return { iters: options.iters, totalMs, opsPerSec };
}

// Build a controller instance with `count` GET routes /bench/r0../bench/r{n-1}.
// Defined via a factory so each benchmark gets a fresh class + metadata.
function makeController(count: number): object {
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
