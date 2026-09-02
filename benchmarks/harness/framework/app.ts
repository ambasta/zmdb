// @zmdb/web — the-benchmarker/web-frameworks contract app.
//
// Strictly implements the shared HTTP contract
// (https://github.com/the-benchmarker/web-frameworks):
//   GET  /          → 2xx, empty body
//   GET  /user/:id  → 2xx, body is the raw `id` path parameter
//   POST /user      → 2xx, empty body
//
// Listens on port 3000 (override with PORT). Built on @zmdb/web's REAL routing:
// Stage-3 @Controller/@Get/@Post decorators, getRoutes (route table resolved
// once at boot — no per-request reflection), and extractParams. It imports the
// BUILT package (../../../packages/web/dist), the same JavaScript a consumer
// installs, so the measurement is of the shipped code rather than of a bundle of
// the source; `run.sh` builds it first. The decorators applied *here* are lowered
// by the esbuild step in run.sh, because no JS runtime executes them natively.
//
// ONE DEFINITION TO RULE THEM ALL: the `User` shape is declared exactly once, as
// an interface, in `./model.ts`. The request body type (`CreateDTO<User>`) and
// the POST /user validator are both derived from it — no second, hand-maintained
// copy of the shape, and no schema value in between.
//
// AOT VALIDATION: the validator is not built at boot and not built here. It was
// compiled from `CreateDTO<User>` by `zmdb-codegen`, which wrote the
// straight-line JavaScript in `model.zmdb.generated.js` and is committed next to
// the interface it came from. The per-request path calls a function whose body is
// three `typeof` tests — no descriptor, no walk, no schema value in the process at
// all. That is the path a user of zmdb gets, so it is the one the published
// number should describe. `@zmdb/web`'s `validateWith` wraps it into the
// framework's `validateBody` hook.
//
// The declaration lives next door rather than in this file because this file
// imports `../../../packages/web/dist`, which is gitignored build output: no
// compiler can be pointed at a program containing it in a fresh checkout, and the
// codegen needs a compiler. `model.ts` imports zmdb sources only, so
// `tsconfig.json` here holds it and `scripts/typecheck.mjs` checks it.
//
// THIS APP GOES THROUGH THE PUBLIC API, like every peer in the suite does.
//
// It used to hand-write its own node:http server: it borrowed @zmdb/web's
// routing primitives (getRoutes/compilePattern/matchCompiled) but re-implemented
// the bucket index and wrote responses itself with res.writeHead/res.end. That
// made the published number an upper bound on a framework nobody can actually
// call — the dispatcher, the adapter and the validation hook, all of which a real
// user pays for, were outside the measurement.
//
// It was done because the contract needs a bare `0` from GET /user/0 and truly
// empty bodies elsewhere, and the framework could only ever emit
// `jsonResponse(200, result)` — `JSON.stringify('0')` is `"0"`, with quotes,
// which fails the suite's own route spec. That gap is now closed by `text()` and
// `respond()`, so the app is what a user would write and the harness measures
// createRouter + toNodeHandler end to end.
//
// Every routed framework in the vendored suite does the same: express, fastify,
// koa, hono, elysia, h3, polka, uWebSockets.js and the rest all register on their
// own router and let the framework write the response. Raw byte-writing appears
// only in implementations explicitly named `vanilla_*` and in routerless
// primitives (hyper, may_minihttp, polkadot) where that IS the public API.

import cluster from 'node:cluster';
import { createServer } from 'node:http';
import { availableParallelism } from 'node:os';

import {
  Controller,
  Get,
  Post,
  createRouter,
  getRoutes,
  respond,
  text,
  toFetchHandler,
  toNodeHandler,
  validateWith,
  type Ctx,
} from '../../../packages/web/dist/index.js';
import { assertUserCreate, type UserCreate } from './model.ts';

// Ensure the well-known Symbol.metadata exists before the decorated class is
// evaluated. @zmdb/web ships this polyfill, but the package is `sideEffects:
// false`, so a bundler may tree-shake the side-effect import — we install it
// explicitly here (a no-op once a runtime ships Symbol.metadata natively).
interface SymbolWithMetadata {
  metadata?: symbol;
}
const symbolCarrier: SymbolWithMetadata = Symbol;
if (symbolCarrier.metadata === undefined) {
  Object.defineProperty(Symbol, 'metadata', {
    value: Symbol.for('Symbol.metadata'),
    configurable: true,
  });
}

// --- AOT-compiled validation ------------------------------------------------
// Nothing is compiled here, which is the point. `assertUserCreate` is already the
// emitted check for `CreateDTO<User>`; `validateWith` only adapts its throw into
// @zmdb/web's validateBody hook shape.
//
// Two earlier versions of this line are worth remembering, because each was a
// weaker claim. The first derived the descriptor in this file — a `columnKind`
// switch over `SqlType` and a `createDtoDescriptor` that re-implemented "drop the
// auto-increment columns" — so the benchmark measured a validator no user gets. The
// second fixed that by reading `objectTypeFromIR(UserSchema.ir, 'create')` at boot,
// which was the same descriptor the repository builds, but still a
// descriptor walked per request. This one is neither: the shape is the control flow
// (REQ-TF-9).
const validateUserCreate = validateWith<UserCreate>(assertUserCreate);

// An empty 2xx: no body and, deliberately, no content-type. The suite asserts the
// body is byte-empty and never looks at the content type (`v/vanilla_epoll`
// passes while announcing application/json for the same empty response).
const EMPTY = respond({ status: 200 });

@Controller()
class BenchmarkController {
  @Get('/')
  root() {
    return EMPTY;
  }

  @Get('/user/:id')
  getUser(ctx: Ctx<{ id: string }>) {
    // `text`, not a plain return: the contract wants the three bytes of `0`, and
    // a JSON-serialised string would be `"0"`.
    return text(ctx.params.id);
  }

  @Post('/user')
  createUser() {
    return EMPTY;
  }
}

const controller = new BenchmarkController();
const routes = getRoutes(BenchmarkController);
const PORT = Number(process.env.PORT ?? 3000);

// The framework's own dispatcher, not a re-implementation of it: register()
// resolves the route table and compiles each pattern once at boot, and handle()
// buckets by (method, segment count) per request.
//
// Validation is registered as the route's `validateBody` hook so it runs where a
// user's would — before the handler, inside the pipeline. The contract's POST
// body is empty, so `undefined` passes straight through; a real payload is
// checked by the compiled validator derived from the `User` interface.
const router = createRouter();
router.register(controller, {
  createUser: {
    validateBody: (raw: unknown) => (raw === undefined ? undefined : validateUserCreate(raw)),
  },
});

// How many processes to run. Node is single-threaded, so a lone process uses one
// core while the Go and Rust peers in this suite default to every core
// (`num_cpus` / `GOMAXPROCS`). This default matches them so a bare `node app.mjs`
// is like-for-like; run.sh overrides it to half the cores, because there the load
// generator shares the box and throughput peaks at cores/2 — see the measured
// curve in run.sh. WORKERS=1 pins it to one core for a per-core reading, and
// whatever is chosen is recorded in the results JSON.
const WORKERS = Math.max(1, Number(process.env.WORKERS ?? availableParallelism()));

// Serving. Node has one option; bun and deno have two, and the choice is worth
// 1.6x on bun and 2.7x on deno.
//
// `createServer(toNodeHandler(router))` is the only path on Node, and under bun or
// deno it still works — via their `node:http` COMPATIBILITY layer, which is not
// what either runtime is fast at. Same box, same bundle, one continuous session,
// median of the nine (route x level) cells:
//
//              via node:http   via native serve
//   bun, 8w           91,386            145,628   1.59x
//   bun, 1w           43,266             59,672   1.38x
//   deno, 8w          46,990            124,839   2.66x
//   deno, 1w          20,553             53,879   2.62x
//
// `Bun.serve` / `Deno.serve` take a `Request -> Response` function, which is
// exactly `toFetchHandler(router)` — also public API, also what hono/elysia/oak do
// on these runtimes, so this is a like-for-like comparison rather than a special
// case built for the benchmark. Both variants pass the byte-exact contract, which
// is what proves `text()`/`respond()` work through the Fetch adapter as well as the
// Node one. `reusePort` is the equivalent of the SCHED_NONE story below: without it
// the cluster workers cannot all accept.
// The two signatures differ — bun takes the handler as a `fetch` option, deno
// takes it positionally — so this branches rather than pretending they are one
// interface.
type FetchHandler = (request: Request) => Promise<Response>;
interface ServeOptions {
  readonly port: number;
  readonly hostname: string;
  readonly reusePort: boolean;
}
const runtime = globalThis as {
  Bun?: { serve(options: ServeOptions & { fetch: FetchHandler }): unknown };
  Deno?: { serve(options: ServeOptions, handler: FetchHandler): unknown };
};

function listen(): void {
  const options: ServeOptions = { port: PORT, hostname: '0.0.0.0', reusePort: true };
  if (runtime.Bun !== undefined) {
    runtime.Bun.serve({ ...options, fetch: toFetchHandler(router) });
    return;
  }
  if (runtime.Deno !== undefined) {
    runtime.Deno.serve(options, toFetchHandler(router));
    return;
  }
  createServer(toNodeHandler(router)).listen(PORT, '0.0.0.0');
}

// node:cluster defaults to SCHED_RR, where the PRIMARY accepts every connection
// and hands each one to a worker over IPC. That primary is single-threaded, and
// with keep-alive disabled every request is a fresh connection, so the primary's
// accept loop — not the workers — sets the ceiling. Under SCHED_NONE the workers
// accept from the shared listening socket themselves. Median of 3 at 16 workers,
// GET /, keep-alive off, the three modes interleaved so drift hits them equally:
//
//            c=64     c=256    c=512
//   SCHED_RR   24747    25719    25607
//   SCHED_NONE 51257    55628    51182
//   reusePort  51448    53183    52171
//
// SCHED_RR is flat across a 8x concurrency range, which is the signature of a
// serialized accept: more load in, same throughput out. SCHED_NONE is ~2.1x it.
// Per-worker `listen({ reusePort: true })` measures the same as SCHED_NONE to
// within run-to-run noise, so it buys nothing to justify the extra option.
//
// The policy must be set before any fork, and it must stay set for the worker
// count to mean anything — under the default, WORKERS=16 is WORKERS=1 with 15
// idle processes.
cluster.schedulingPolicy = cluster.SCHED_NONE;

// With WORKERS > 1 the primary forks and never serves; each worker calls
// listen() on the same port and accepts for itself. The primary replaces a worker
// that dies so a mid-run crash cannot silently shrink the pool and quietly
// depress the numbers.
if (WORKERS > 1 && cluster.isPrimary) {
  for (let i = 0; i < WORKERS; i += 1) cluster.fork();
  let live = WORKERS;
  cluster.on('exit', () => {
    live -= 1;
    if (live < WORKERS) {
      cluster.fork();
      live += 1;
    }
  });
  console.info(`@zmdb/web benchmark app on :${PORT} (${WORKERS} workers, ${routes.length} routes)`);
} else {
  listen();
  if (WORKERS === 1) {
    console.info(
      `@zmdb/web benchmark app on :${PORT} (single process, ${routes.length} routes, POST /user validated by the compiled check for CreateDTO<User>)`,
    );
  }
}
