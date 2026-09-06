`@zmdb/web` resolves each controller's route table **once** at `register`/`compile` time and never re-reads `Symbol.metadata` per request. This is the concrete, testable form of the "no per-request
reflection" claim — and it is the key difference from `reflect-metadata`-based frameworks that call `Reflect.getMetadata()` on every request.

## The init-time-resolution guarantee (verified)

A repository-private regression guard instruments a controller's `Symbol.metadata` with a counting getter, then asserts it is read at `register` and **zero additional times** across repeated `handle`
calls. The probe lives with `packages/web/src/bench/bench.spec.ts`; it is not a published application entry point.

This correctness test stays in the suite, so the guarantee cannot silently regress.

## Microbench harness

The repository-private `benchmarkRouter` and `benchmarkAppStartup` helpers return **raw timings** — `{ iters, totalMs, opsPerSec }` — and deliberately no composite score. They support controlled
framework qualification from `packages/web/src/bench`, but `@zmdb/web/bench` is not published.

The helpers have no built-in pass/fail threshold. Startup timing depends on the module graph and machine, so maintainers record comparable runs only in a controlled environment.

## Observability overhead — off, API no-op and recording exporter

Measured on 2026-09-05 with Node 26.8.1 on an AMD Ryzen 7 7840U, using `@opentelemetry/api` 1.9.1 and `@opentelemetry/sdk-trace-base` 2.11.0. Each row is the median of six samples. All six mode orders
were used, so every mode appeared twice in each ordinal position; each workload/mode received 750 ms of warmup and the off path calibrated a 250 ms sample size shared by all three modes.

| workload | configuration      | median ns/op | median ops/s | overhead vs off | exported spans/op | max/min spread |
| -------- | ------------------ | -----------: | -----------: | --------------: | ----------------: | -------------: |
| request  | off                |       330.10 |      3029418 |        baseline |                 0 |         1.066x |
| request  | API no-op          |      1207.65 |       828052 |         +265.8% |                 0 |         1.066x |
| request  | recording exporter |      6498.62 |       153879 |        +1868.7% |                 3 |         1.055x |
| query    | off                |        70.49 |     14185610 |        baseline |                 0 |         1.088x |
| query    | API no-op          |       315.43 |      3170305 |         +347.5% |                 0 |         1.142x |
| query    | recording exporter |      2454.04 |       407491 |        +3381.2% |                 1 |         1.023x |

The request workload is one matched `GET` and records the server, route and handler spans. The query workload is one compiled `SELECT` through `tracedDriver` and records one client span. The recording
case uses a real `BasicTracerProvider`, `SimpleSpanProcessor` and bounded exporter; exporter flush/reset are outside the timed interval, and metrics are disabled in all three modes. The raw 36
samples, runtime provenance and SHA-256 manifest of every benchmark input are committed in `benchmarks/site/observability.json`.

## End-to-end HTTP — the-benchmarker/web-frameworks

Beyond the in-process microbench, `@zmdb/web` participates in **[the-benchmarker/web-frameworks](https://github.com/the-benchmarker/web-frameworks)** under its exact shared contract (`GET /` empty,
`GET /user/:id` → the id, `POST /user` empty, on port 3000). The app is validated by the shared correctness contract, then driven with **`oha`** (`GET /` 15s, keep-alive disabled, latency-corrected,
JSON report), collecting **req/s + p50/p75/p90/p99** — concurrency and routes configurable exactly like upstream. Reproduce it with `benchmarks/harness/framework/run.sh` (see `framework/SPEC.md`).
`oha` is auto-downloaded (pinned) if absent; the shipped numbers are real (0 HTTP errors), never fabricated.

## Same-machine, apples-to-apples peer head-to-head

Published cross-framework tables run on someone else's hardware.

So the harness also builds and load-tests **17 real peer frameworks on the same machine** with the **identical** `oha`, levels, routes and duration as `@zmdb/web`, verifying each peer's contract
before recording anything: **Node** (fastify, hono, express, koa), **Bun** (elysia, hono), **Deno** (hono, oak), **Go** (gin, fasthttp, chi, net/http), **Rust** (actix, axum) and **Python** (fastapi,
flask, django).

Peers whose toolchain/build/contract is unavailable are recorded as _skipped with a reason — never faked_. Run it with `benchmarks/harness/framework/peers/peers-run.sh`; the
[dashboard](../benchmarks/index.html) renders the ranking (sortable, per concurrency level + route) with `@zmdb/web` highlighted, kept separate from the "published, different machine" upstream context
panel.

## Reporting policy

Consistent with the rest of the [benchmarks](../benchmarks/index.html):

- We report **real timings** from real runs; we do **not** fabricate cross-framework numbers in the test suite.
- The meaningful, machine-checked claim is **architectural**: route resolution is init-time (0 per-request metadata reads), unlike `emitDecoratorMetadata` + `reflect-metadata` designs that reflect per
  request.
- We make **no "fastest framework"** claim we have not earned across a full, reproducible workload.

## Cross-links

- [Request pipeline](./web-pipeline.html) · [Controllers & routing](./web-controllers.html) · [Benchmarks (overview)](../benchmarks/index.html)
