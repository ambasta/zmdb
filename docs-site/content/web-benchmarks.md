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

The runnable `node benchmarks/scripts/app-startup.mjs --quick` command produces a short diagnostic. The [2026-09-08 startup capture](../benchmarks/app-startup.json) compares clean pre-extraction
`7eb865f1` with `409b1ba2`: eight alternating samples of 20,000 eager creations after warmup gave medians of 1.760 µs and 1.617 µs. This small one-module/one-provider workload excludes imports, init
hooks and requests; it does not measure cold-process startup. Full revisions, commands and raw samples are in the capture.

## Observability overhead — off, API no-op and recording exporter

Measured on 2026-09-08 with Node 26.8.1 on an AMD Ryzen 7 7840U, using `@opentelemetry/api` 1.9.1 and `@opentelemetry/sdk-trace-base` 2.11.0. Each row is the median of six samples. All six mode orders
were used, so every mode appeared twice in each ordinal position; each workload/mode received 750 ms of warmup and the off path calibrated a 250 ms sample size shared by all three modes.

| workload | configuration      | median ns/op | median ops/s | overhead vs off | exported spans/op | max/min spread |
| -------- | ------------------ | -----------: | -----------: | --------------: | ----------------: | -------------: |
| request  | off                |       316.94 |      3155171 |        baseline |                 0 |         1.056x |
| request  | API no-op          |      1157.17 |       864177 |         +265.1% |                 0 |         1.021x |
| request  | recording exporter |      6052.64 |       165217 |        +1809.7% |                 3 |         1.037x |
| query    | off                |        71.39 |     14007930 |        baseline |                 0 |         1.040x |
| query    | API no-op          |       292.32 |      3420923 |         +309.5% |                 0 |         1.033x |
| query    | recording exporter |      2295.18 |       435696 |        +3115.1% |                 1 |         1.015x |

The request workload is one matched `GET` and records the server, route and handler spans. The query workload is one compiled `SELECT` through `tracedDriver` and records one client span. The recording
case uses a real `BasicTracerProvider`, `SimpleSpanProcessor` and bounded exporter; exporter flush/reset are outside the timed interval, and metrics are disabled in all three modes. The raw 36
samples, runtime provenance and SHA-256 manifest of every benchmark input are committed in `benchmarks/site/observability.json`.

## End-to-end HTTP — the-benchmarker/web-frameworks

Beyond the in-process microbench, `@zmdb/web` participates in **[the-benchmarker/web-frameworks](https://github.com/the-benchmarker/web-frameworks)** under its exact shared contract (`GET /` empty,
`GET /user/:id` → the id, `POST /user` empty, port configurable). The app is validated by the shared correctness contract, then driven with **`oha`**, with keep-alive disabled and latency correction,
collecting **req/s + p50/p75/p90/p99**. Reproduce it with `benchmarks/harness/framework/run.sh` (see `framework/SPEC.md`).

The [2026-09-08 Node capture](../benchmarks/framework-results.json) uses Node 26.8.1, oha 1.16.0 and eight workers: three 5-second samples per route/concurrency cell after warmup, 27 recorded samples
in total. Completed responses have zero HTTP errors; raw reports retain oha's duration-deadline abort counts. The harness bundles the current public sources with esbuild, so this is a source-bundle
measurement. `oha` is auto-downloaded (pinned) if absent. `node benchmarks/scripts/bench.mjs framework` refreshes zmdb on Node by default; peer runs require an explicit `--include-peers`.

## Historical same-machine peer head-to-head

The peer and Bun/Deno results below were not rerun for the 2026-09-08 refresh. The normalized data preserves each row's original measurement date, runtime version and methodology; these captures are
not simultaneous comparisons with the new Node result.

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
