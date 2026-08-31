# `@zmdb/web` framework benchmark — SPEC

Strict participation in **[the-benchmarker/web-frameworks](https://github.com/the-benchmarker/web-frameworks)**:
the smallest `@zmdb/web` app that fulfils the shared HTTP contract, driven with
the same methodology the upstream suite uses.

## The shared contract (verbatim from upstream)

Every implementation listens on port **`3000`** and provides exactly:

| Method | Route       | Expected status | Expected body           |
| ------ | ----------- | --------------- | ----------------------- |
| `GET`  | `/`         | `2xx`           | Empty                   |
| `GET`  | `/user/:id` | `2xx`           | The `id` path parameter |
| `POST` | `/user`     | `2xx`           | Empty                   |

Before benchmarking, the routes are validated by a shared correctness contract
(upstream uses an RSpec spec; we ship the Node equivalent `contract-check.mjs`).
The runner **refuses to benchmark** an app that fails the contract.

## Methodology (matches upstream defaults)

- Load generator: **`oha`** (the current upstream generator).
- Default run: **`GET /` for 15s**, **keep-alive disabled**
  (`--disable-keepalive`), **latency correction** (`--latency-correction`),
  machine-readable **JSON report** (`--output-format json`).
- **Concurrency and routes are configurable**, exactly like upstream's
  `CONCURRENCIES` / `ROUTES` knobs:

  ```sh
  CONCURRENCIES=64,256,512 ROUTES='GET:/,GET:/user/42,POST:/user' \
    bash benchmarks/harness/framework/run.sh
  ```

- Collected fields (from oha's JSON): **requests/sec**, **total data received**,
  **run duration**, and the **p50 / p75 / p90 / p99** latency percentiles.
- Config is expressed the upstream way in `config.yaml`
  (`framework: { website, version, engine }`); the language-layer settings
  (Node engine, bootstrap/command) are the upstream `javascript/config.yaml`
  layer — reproduced here by `run.sh`.

## The app (`app.ts`)

Built on `@zmdb/web`'s **real** routing: Stage-3 `@Controller` / `@Get` /
`@Post` decorators, the route table resolved **once** at boot via `getRoutes`
(no per-request reflection), and `extractParams` for the `:id` parameter — the
exact primitives `@zmdb/web`'s own dispatcher uses.

Because the upstream contract requires **exact/plain** bodies (a bare `id`,
truly empty responses) rather than JSON envelopes, the app writes responses
directly through `node:http`. The framework's route table + parameter extraction
are what is exercised; only the tiny response-shaping is inlined so the bytes are
contract-exact. `run.sh` compiles `app.ts` with esbuild first, so the Stage-3
decorators are lowered for execution (Node 26 / V8 does not yet run standard
decorators natively).

## Honesty policy

Consistent with the other harnesses (see `../README.md`):

- The app is validated against the shared contract **before** any load run; a
  non-compliant app is never benchmarked.
- We publish **real** oha output (req/s + percentiles) from real runs on stated
  hardware; we do **not** fabricate numbers or paste upstream figures.
- These are **minimal HTTP throughput/latency** tests, not a full-application
  benchmark — exactly the caveat upstream states. Numbers are only comparable
  across the same machine, benchmark revision, and runtime variant.
- `@zmdb/web` uses **zero `reflect-metadata`** and resolves routes at init time;
  the architectural claim (no per-request reflection) is separately verified by
  the unit guard in `packages/web/src/bench` — this harness measures end-to-end
  HTTP throughput, not that guard.

## Files

- `app.ts` — the contract app on `@zmdb/web`.
- `config.yaml` — upstream per-framework config (website, version, engine).
- `contract-check.mjs` — the RSpec-equivalent shared correctness check.
- `run.sh` — build → compile → serve on :3000 → verify contract → `oha` →
  collect req/s + p50/p75/p90/p99 (per concurrency, under `./.results/`).

## Requirements

- `@zmdb/web` (workspace) — built by `run.sh`.
- `oha` (https://github.com/hatoo/oha) and `jq` on `PATH`. If `oha` is absent,
  `run.sh` still verifies the contract and then skips the load run with a note.
