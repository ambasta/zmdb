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

The app goes through the **public API** end to end: `createRouter()`,
`router.register(controller, { … validateBody })`, and `toNodeHandler(router)`
into `createServer`. Nothing about the request path is re-implemented here.

It did not always. The upstream contract requires **exact** bodies — a bare `id`
from `GET /user/0`, truly empty responses elsewhere — and the pipeline used to
wrap every handler result in `jsonResponse(200, result)`, so the only expressible
body was JSON and `JSON.stringify('0')` is `"0"` with quotes. The app therefore
wrote its responses directly through `node:http`, which meant the published
number was an upper bound on a framework nobody could actually call: the
dispatcher, the adapter and the validation hook were all outside the
measurement. `json()` / `text()` / `respond()` closed that gap.

Moving the measurement inside the framework turned out to cost **nothing
detectable**. Both variants, built from one tree and interleaved over 5 rotated
passes per core: public API **29,698** req/s, hand-written **27,930**, pass spreads
1.03× and 1.08×. An earlier reading claimed a 17% drop; that compared two
different sessions on a CPU that throttles 5.13 → 2.8 GHz, and is withdrawn. See
`../../RESULTS.md` for the interleaved methodology and why sequential blocks are
not trustworthy on this hardware.

Every routed framework in the vendored peer suite does the same — express,
fastify, koa, hono, elysia, h3, polka, uWebSockets.js all register on their own
router and let the framework write the response. Direct byte-writing appears only
in implementations explicitly named `vanilla_*` and in routerless primitives
(hyper, may_minihttp, polkadot) where that _is_ the public API.

`run.sh` compiles `app.ts` with esbuild first, so the Stage-3 decorators are
lowered for execution (Node 26 / V8 does not yet run standard decorators
natively).

## Runtimes

`RUNTIME=node` (default) `| bun | deno` selects which runtime serves the app. The
app is bundled once and all three execute the same bundle, so a cross-runtime
comparison varies only the runtime. Deno is auto-downloaded (pinned) into
`./.bin` on the same terms as `oha`, and — unlike `oha` — a failure to resolve it
aborts, because silently falling back to Node would publish a number under the
wrong label.

```sh
RUNTIME=deno bash benchmarks/harness/framework/run.sh
```

All three implement `node:cluster` well enough for this app: each forks, and
every worker binds the same port and accepts from the shared listening socket, so
no runtime has to be pinned to a single process. Deno needs `--allow-run` on top
of the obvious permissions, because `cluster.fork()` there spawns the deno binary
itself; without it the primary announces that it is listening and _then_ dies, so
the only symptom is a connection refused from the contract check.

Node keeps the canonical `framework-results.json` the dashboard reads; bun and
deno write `framework-results-<runtime>.json`, so a run on one runtime cannot
overwrite a number measured on another.

## Interleaving, and why sequential runs on this box are not trustworthy

`peers/peers-run.sh` measures one framework at a time, all of its cells, then moves
on. That is upstream's shape, and on stable hardware it is fine. **This box is not
stable hardware**: it throttles from 5.13 GHz to ~2.8 GHz under sustained load, so
a framework measured 40 minutes into a run is measured on a materially slower CPU
than the one measured first. The effect is up to ~2×, which is larger than most of
the margins the suite is trying to resolve — the identical `@zmdb/web` code path
medianed **76,871** req/s in one sequential session and **93,647** in another.

`peers/interleaved-run.sh` is the answer for any comparison whose margin matters:

```sh
bash benchmarks/harness/framework/peers/peers-run.sh        # once, to stage + install peers
PASSES=5 bash benchmarks/harness/framework/peers/interleaved-run.sh
```

Each **pass** visits every candidate once, and the visiting order **rotates**
between passes, so position in the thermal ramp is not a fixed property of any
candidate. The per-candidate result is the median over passes, published beside the
pass spread (`max/min`) — a margin that falls inside the spreads is reported as no
result. The CPU clock is sampled immediately before every individual measurement
and kept in `interleaved-measurements.csv`, so the throttling is visible in the
data rather than something a reader has to take on trust.

Every candidate serves from **one process**, because no peer app clusters; that
makes it the per-core, like-for-like reading. It also measures our own app twice —
once through the public API and once as the hand-written `node:http` app from git
`HEAD` — so the cost of the framework's own dispatcher is an A/B inside the same
experiment instead of a comparison across sessions.

Two failure modes it defends against, both of which produced plausible-looking
wrong numbers first:

- A candidate that is killed by subshell PID leaves its server holding `:3000`. The
  next candidate then fails to bind while the readiness probe happily gets a `200`
  from the **stale** server — which is how five different frameworks once reported
  identical throughput. Candidates now run in their own process group, are killed
  by group, and the port is asserted free before the start and after the stop.
- `yarn --cwd` is not a yarn 4 flag. It fails silently, so a bundle can go unbuilt
  and be measured as `NOT_READY` (or worse, not noticed). Both bundles are now
  size-checked before any measurement runs.

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
  collect req/s + p50/p75/p90/p99 (per concurrency, under
  `./.results/<runtime>/`).
- `framework-results.json` (node) / `framework-results-<runtime>.json` (bun,
  deno) — the published, the-benchmarker-shaped output; each records the runtime
  and its version, because "N req/s" is not a claim you can make without naming
  which runtime served it.
- `peers/interleaved-run.sh` — the order-rotated head-to-head against the JS/TS
  class (see above), writing `peers/interleaved-results.json` (medians + pass
  spreads) and `peers/interleaved-measurements.csv` (every measurement, with the
  CPU clock it was taken at).

## Requirements

- `@zmdb/web` (workspace) — built by `run.sh`.
- `oha` (https://github.com/hatoo/oha) and `jq` on `PATH`. If `oha` is absent,
  `run.sh` still verifies the contract and then skips the load run with a note.
- For `RUNTIME=bun`, `bun` on `PATH`. For `RUNTIME=deno`, `deno` on `PATH` or a
  network fetch of the pinned build (which needs `unzip`).
