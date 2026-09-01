# Benchmark Results (real upstream suites, honest accounting)

> zmdb run inside the **actual upstream benchmark harnesses** against **real
> competitor libraries**. Reproduction: [`harness/`](./harness).
> Environment: local dev box, Node 26.8.1, real PostgreSQL 16 (podman).
>
> 📊 **Interactive dashboard** (charts, Node/Bun/Deno tabs):
> https://ambasta.github.io/zmdb/benchmarks/ — source in [`site/`](./site),
> built + deployed via GitHub Pages (docs at the root, benchmarks under
> `/benchmarks/`).

---

## ORM — drizzle-benchmarks (real methodology: HTTP servers + k6)

This is the upstream method: one **HTTP server per ORM** (each using its own
query builder over the same `pg` pool + real Northwind data — 10k customers /
50k orders / 308k order-details), driven by the upstream **k6** request replay
(`data/requests.json`). Servers built from the upstream routes; run via the
harness in `harness/orm/`.

**Benchmark config** (like the upstream dashboards, stated for reproducibility):

|          |                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Database | PostgreSQL 16 (podman), same instance for all ORMs                                                                                  |
| Dataset  | Northwind — 10k customers, 200 employees, 1k suppliers, 5k products, 50k orders, **308,224 order_details**                          |
| Driver   | `pg` (node-postgres) pool, `max: 10` — identical across ORMs                                                                        |
| Load     | k6 ramping-VUs 0→200→400, ~25s; full `requests.json` replay (13 routes incl. `/search-*`)                                           |
| ORMs     | drizzle-orm 0.36 (node-postgres), kysely 0.29 (PostgresDialect), zmdb query-compiler                                                |
| Machine  | single local dev box, Node 26.8.1 (server + k6 co-located, so absolute numbers are lower than the upstream 2-machine / 3000-VU rig) |

> ⚠️ Unlike the upstream dashboards (2 machines, 1GB ethernet, ramp to 3000 VUs
> over ~10 min), this runs server + load on one box with a short ramp — so treat
> the **relative** ordering as indicative and the **absolute** numbers as low.

### Feature coverage — each route listed individually (not summed)

Every upstream route is listed on its own — no scoring, no aggregation into a
single number. All 13 are now served (HTTP 200 with correct data); the "why"
column records how each formerly-DNF route was closed.

| Route                              | drizzle | kysely | zmdb | how the zmdb gap was closed             |
| ---------------------------------- | :-----: | :----: | :--: | --------------------------------------- |
| `/customers` (list+paginate)       |   ✅    |   ✅   |  ✅  | (already served)                        |
| `/customer-by-id`                  |   ✅    |   ✅   |  ✅  | (already served)                        |
| `/employees`                       |   ✅    |   ✅   |  ✅  | (already served)                        |
| `/suppliers`                       |   ✅    |   ✅   |  ✅  | (already served)                        |
| `/supplier-by-id`                  |   ✅    |   ✅   |  ✅  | (already served)                        |
| `/products`                        |   ✅    |   ✅   |  ✅  | (already served)                        |
| `/order-with-details-and-products` |   ✅    |   ✅   |  ✅  | 2-query populate                        |
| `/employee-with-recipient`         |   ✅    |   ✅   |  ✅  | JOIN builder (self-join, #88)           |
| `/product-with-supplier`           |   ✅    |   ✅   |  ✅  | JOIN builder (#88)                      |
| `/orders-with-details` (agg list)  |   ✅    |   ✅   |  ✅  | aggregate builder, GROUP BY on FK (#93) |
| `/order-with-details` (agg by id)  |   ✅    |   ✅   |  ✅  | aggregate builder, GROUP BY on FK (#93) |
| `/search-customer` (full-text)     |   ✅    |   ✅   |  ✅  | FTS builder `whereMatch` (#97)          |
| `/search-product` (full-text)      |   ✅    |   ✅   |  ✅  | FTS builder `whereMatch` (#97)          |

**As originally measured, zmdb served only 7 of the 13 upstream routes** — the 6
join/aggregate/FTS routes were DNF, and in the actual replay those routes are
**57.8% of all requests** (the two 100k-request JOIN routes dominate). That was
a real, significant feature gap.

> **Status update — all 13 routes now served (0 DNF):** the query-compiler gained
> JOIN (`joinableSelectFrom`, #85), aggregation (`aggregateSelectFrom`, #90), and
> full-text-search (`ftsSelectFrom`, #95) builders, and every previously-DNF
> route is now wired and returns **HTTP 200 with correct data**, verified against
> real Postgres:
>
> - **FTS** `/search-customer`, `/search-product` — FTS builder (#97).
> - **JOIN** `/employee-with-recipient` (self-join), `/product-with-supplier` —
>   JOIN builder (#88). Repository `findJoined` also passes E2E (#87).
> - **Aggregates** `/orders-with-details`, `/order-with-details` — aggregate
>   builder grouping on the FK in `order_details` (#93); order 10500 → count 15,
>   sum 1038, cross-checked vs raw SQL. Repository `aggregate` passes E2E (#92).
>
> **Honest caveats:** (1) the aggregate routes return the per-order aggregate
> shape (`order_id`, `products_count`, `quantity_sum`) via GROUP-BY on the child
> table — zmdb's aggregate builder does **not** join in the parent `orders`
> columns (shipName, etc.), so the shape differs slightly from drizzle/kysely's
> joined projection while the aggregate values match. (2) On the full 13-route
> k6 run (throughput below), zmdb leads on req/s and average latency; drizzle
> keeps the best tail — a genuine trade-off, **not** a "fastest ORM" claim.
> Server-side prepared statements (`ZMDB_PREPARED=1`) reproducibly narrow the
> gap (see the head-to-head).

### Throughput & latency — k6, FULL 13-route replay (all serve every route, 0 failures)

Full upstream replay (every route, including the heavy `/search-*` full-text
queries, 426,999 requests); all three ORMs return 200 on every request. Latency
in ms, from the same k6 run (ramp to 400 VUs). p50 omitted — k6
`--summary-export` does not emit it; avg/p90/p95 are the measured percentiles.

| ORM                 |     req/s |      avg |       p90 |       p95 | failed |
| ------------------- | --------: | -------: | --------: | --------: | -----: |
| **zmdb (prepared)** | **3,068** | **97.3** |     179.5 |     209.5 |      0 |
| **zmdb** (default)  |     2,916 |    102.4 |     192.8 |     215.5 |      0 |
| drizzle             |     2,795 |    106.8 | **157.6** | **173.8** |      0 |
| kysely              |     2,733 |    109.3 |     176.8 |     200.8 |      0 |

- **Honest read (mixed):** zmdb (default) leads on **throughput (2,916 req/s)**
  and **average latency (102 ms)**; **drizzle keeps the best tail** (p95 173.8 vs
  zmdb 215.5). So zmdb is fastest on throughput and average, drizzle tightest on
  the tail — a genuine trade-off, **not** an outright "fastest ORM" win.

### Prepared-statement head-to-head (the tail-latency lever, verified)

Same zmdb server with `ZMDB_PREPARED=1` — Postgres caches the query plan
server-side (a stable statement name per compiled SQL). Two back-to-back runs:

| run | variant      |     req/s |      avg |       p90 |       p95 |
| --- | ------------ | --------: | -------: | --------: | --------: |
| 1   | default      |     2,916 |    102.4 |     192.8 |     215.5 |
| 1   | **prepared** | **3,068** | **97.3** | **179.5** | **209.5** |
| 2   | default      |     2,903 |    102.8 |     193.7 |     220.3 |
| 2   | **prepared** | **3,010** | **99.2** | **182.6** | **206.5** |

- **Verdict:** `ZMDB_PREPARED=1` reproducibly improves zmdb — **+4–5% req/s,
  −3–4% avg, ~−11 ms p90, ~−9–14 ms p95.** The tail-latency lever documented as
  a design mitigation **works empirically**. It stays **opt-in** so the default
  keeps the zero-state (no hidden statement cache) guarantee; drizzle still owns
  the absolute tail.
- Rankings sit within a few % and can swap run-to-run; the short ramp keeps
  absolute numbers well below a big-iron run (see config below).

#### Earlier CRUD-subset run (reference, pre-wiring)

Before the join/aggregate/FTS routes were wired, a CRUD-only k6 run (156,999
requests, 0 failures) showed zmdb 6,666 req/s (p95 90ms) · kysely 6,388 (90ms) ·
drizzle 4,789 (128ms). Superseded by the full-13 run above.

### Not run here (stated, not faked)

- **Prisma** — DNF (not implemented: engine/codegen not installed).
- Ramp/machine differences vs the upstream 2-machine rig are covered in the
  **Benchmark config** block above.

---

## Validation — typescript-runtime-type-benchmarks (upstream runner)

zmdb added as **two** cases in the upstream runner (`ts-node index.ts run …`):
`zmdb` (the shipped **runtime** validator) and `zmdb-aot` (the **AOT** path
produced by the real transformer). Per-case ops/s; `DNF` = case the library does
not register:

| library                           |   parseSafe | parseStrict | assertLoose | assertStrict | DNF cases              |
| --------------------------------- | ----------: | ----------: | ----------: | -----------: | ---------------------- |
| typia (AOT)                       | 100,673,513 |  38,869,470 |  78,128,590 |   31,056,106 | —                      |
| **zmdb-aot** (transformer-built¹) | 101,677,075 |  40,022,611 | 108,934,303 |   42,287,002 | —                      |
| @sinclair/typebox (JIT)           |         DNF |         DNF |  88,070,252 |   29,157,066 | parseSafe, parseStrict |
| ajv                               |         DNF |         DNF |  43,363,522 |   29,246,420 | parseSafe, parseStrict |
| zod (v4)                          |   8,711,299 |   4,895,742 |   4,173,432 |    4,172,722 | —                      |
| arktype                           |         DNF |   3,998,596 |  64,604,434 |    3,983,815 | parseSafe              |
| myzod                             |   3,364,233 |   3,837,054 |         DNF |    3,872,625 | assertLoose            |
| valibot                           |   1,757,211 |   1,370,568 |   1,801,433 |    1,530,501 | —                      |
| **zmdb** (runtime, shipped)       |   1,430,813 |   1,101,908 |   5,173,050 |    1,162,280 | —                      |
| zod (v3)                          |   1,087,654 |     970,236 |   1,051,654 |    1,014,129 | —                      |

¹ **`zmdb-aot` numbers are transformer-PRODUCED.** The validators were generated
by running the real `@zmdb/aot-validator` transform (`transformTypeChecks`) over
`is<T>()` source for the moltar model — i.e. the exact inline JS the build plugin
emits (`@zmdb/aot-validator/plugin`, epics #75/#79–#83) — then run through the
upstream moltar runner. Not hand-written. The shipped default is still the
`zmdb` runtime row unless the transformer plugin is enabled in the consumer build.

### What this shows (honestly)

- **The AOT premise holds — real transformer output.** Transformer-built
  `zmdb-aot` is **~40–100× the `zmdb` runtime** across the four cases, in typia's
  league and **far ahead of zod v4** (the case that motivated this).
- **Parse: fixed (1.56× faster).** The parse case used to allocate a fresh result
  object; the shipped `parse<T>` contract returns the validated input as-is (no
  transform/coercion for a plain structural type — same as typia's
  `assertParse`). A low-noise probe measured 153M vs 98M ops/s. After the fix
  **Node leads parseStrict/assertLoose/assertStrict and Deno leads all four.**
- **Strict cases: competitive.** Inlined `for-in` excess-key count (no helper
  call, no `Object.keys()` allocation). zmdb-aot leads Node/Deno strict; typia
  wins Bun strict (Bun-JIT-specific).
- **assertLoose is already optimal.** Our single boolean-chain `is()` (352M ops/s)
  beats `new Function()` JIT (124M) — static CSP-safe emission, no runtime eval.
- **Runtimes matter** — Node/Bun/Deno (see dashboard). Bun's JIT can dead-code-
  eliminate no-op assert bodies, so treat its extreme values with caution.
- **The shipped, out-of-the-box path is still the `zmdb` runtime** unless the
  transformer plugin is enabled. With the plugin, code gets the AOT path.

### Cross-runtime (Node / Bun / Deno) — `zmdb-aot`, ops/sec

The full per-library × per-runtime matrix is in the interactive dashboard
([benchmarks/site](./site), published to GitHub Pages). `zmdb-aot` summary:

| runtime |   parseSafe | parseStrict |  assertLoose | assertStrict |
| ------- | ----------: | ----------: | -----------: | -----------: |
| node 26 |  87,600,000 |  44,600,000 |  102,200,000 |   49,900,000 |
| bun 1.4 | 100,600,000 |  40,700,000 | 942,400,000² |   41,600,000 |
| deno 2  | 174,500,000 |  67,600,000 |  182,000,000 |   60,300,000 |

² Bun's JIT eliminates the no-op `assertLoose` body — implausible, flagged.

### Where we don't win — gaps & trade-offs

We do **not** win every case in every runtime, but removing the wasteful
object-rebuild from the parse path (the shipped `parse<T>` returns the validated
input as-is — measured **1.56x** faster in a low-noise probe) closed most gaps.
Ranking `zmdb-aot` against the whole field (leader shown when we're behind):

| runtime | case         | zmdb-aot rank                     |
| ------- | ------------ | --------------------------------- |
| node    | parseSafe    | #2 — typia 1.05x _(noise)_        |
| node    | parseStrict  | **leads**                         |
| node    | assertLoose  | **leads**                         |
| node    | assertStrict | **leads**                         |
| bun     | parseSafe    | **leads**                         |
| bun     | parseStrict  | #2 — typia 2.45x _(Bun JIT)_      |
| bun     | assertLoose  | leads _(DCE artifact — not real)_ |
| bun     | assertStrict | #3 — typia 2.48x _(Bun JIT)_      |
| deno    | parseSafe    | **leads**                         |
| deno    | parseStrict  | **leads**                         |
| deno    | assertLoose  | **leads**                         |
| deno    | assertStrict | **leads**                         |

Classification (full write-up on the [dashboard](https://ambasta.github.io/zmdb/benchmarks/#gaps)):

- **Parse vs typia — now noise-level.** `is`-check is byte-identical to typia's;
  after dropping the rebuild the two trade the lead run-to-run. **Node/Deno now
  lead all real cases.** #162 tracks any residual micro-tuning.
- **assertLoose — NOT a real gap.** Measured our single boolean-chain `is()` at
  **352M ops/s**, _faster_ than `new Function()` JIT (124M), early-return (126M),
  hoisted (89M). Static CSP-safe emission already beats the JIT approach; the
  earlier "1.13x behind TypeBox-JIT" was harness noise — reclassified.
- **Strict caps ~40-60M** — property of excess-key enumeration; we lead
  Node/Deno strict.
- **Bun strict favours typia (~2.4x)** — Bun-JIT-specific (same runtime that
  DCE-fakes assertLoose); not a portable gap.
- **Runtime default loses to zod v4** — by design; peak needs the AOT plugin.
- **ORM tail (p95 256 vs 207)** — the compile step is ~254ns, negligible vs the
  ~112ms round-trip, so a compile cache won't help; the tail is round-trip +
  pool contention + GC variance inherent to the stateless design. Real lever is
  server-side prepared statements — harness now has an opt-in `ZMDB_PREPARED=1`
  path; a plan cache is the planned mitigation, kept opt-in to preserve the
  zero-state guarantee.

## Framework (HTTP) — the-benchmarker/web-frameworks (real contract + oha)

`@zmdb/web` (the Stage-3 decorator web framework) participates in
**[the-benchmarker/web-frameworks](https://github.com/the-benchmarker/web-frameworks)**
under its exact shared contract, driven with the upstream methodology (`oha`,
`GET /` 15s, keep-alive disabled, latency-corrected, JSON report; configurable
concurrency + routes). Harness: [`harness/framework/`](./harness/framework)
(SPEC: [`framework/SPEC.md`](./harness/framework/SPEC.md)).

### Contract compliance — verified (the RSpec-equivalent check)

The app on port `3000` passes all shared-contract assertions before any load run:

| Method | Route       | Status | Body     | Result        |
| ------ | ----------- | ------ | -------- | ------------- |
| `GET`  | `/`         | 200    | empty    | ✓             |
| `GET`  | `/user/:id` | 200    | the `id` | ✓ (42, 99999) |
| `POST` | `/user`     | 200    | empty    | ✓             |

`contract-check.mjs` → **PASSED — app fulfills the-benchmarker/web-frameworks
contract.** The app is built on `@zmdb/web`'s real routing (Stage-3
`@Controller`/`@Get`/`@Post`, `getRoutes` resolved once at boot, route patterns
compiled at boot by `compilePattern` and matched per request by `matchCompiled`).

### Throughput & latency — measured (real oha, `oha` auto-downloaded)

`run.sh` auto-downloads a pinned `oha` prebuilt binary (linux amd64/arm64) when
absent, then runs the upstream methodology — concurrency **64/256/512** × the
three contract routes, keep-alive disabled, latency-corrected — and emits
`framework-results.json` in the-benchmarker `data.min.json` shape (req/s,
average, p50/p75/p90/p99/p99999, totals, `http_errors`, stddev, duration). The
shipped dataset was measured on **Linux x86_64, Node 26.8.1**, every route
returning **0 HTTP errors**.

```sh
bash benchmarks/harness/framework/run.sh          # levels 64/256/512, 3 routes, cores/2 workers
REPEATS=5 bash benchmarks/harness/framework/run.sh   # more repeats, tighter spread
WORKERS=1 bash benchmarks/harness/framework/run.sh   # per-core, one process
WORKERS=16 bash benchmarks/harness/framework/run.sh  # every core, as the Go/Rust peers do
```

#### Why each cell is repeated

A single `oha` run of this workload is not a measurement. With
`--disable-keepalive` every request opens a TCP connection, so a run's result
depends on the kernel's ephemeral-port state — which it _inherits_ from whatever
ran before it. On the reference box ~26k of the 28,231-port range sits in
TIME_WAIT under load, and five back-to-back runs of one unchanged binary have
been observed spanning **3.4×**. So each cell runs a discarded **warmup** (to put
the port table in the same state every recorded run will see), then `REPEATS`
recorded runs reduced to the **median run** — one real run, so its percentiles
stay consistent with the throughput beside them. `requests_per_s_min` and
`requests_per_s_max` publish the spread; under this protocol on a quiet box the
same cells reproduce within **1.01–1.15×**.

This noise is a property of the box, not of any one framework, but it does **not**
hit every framework equally, and the asymmetry is the interesting part. Measured
in one settled session, the Rust and Go peers repeated to within 1.004× while the
two Node servers — `@zmdb/web` and fastify alike — spanned 1.1–2.5×. A framework
whose per-request cost leaves it far below the box's connection-churn ceiling is
insensitive to how much of that ceiling is left; one operating near it is not. So
single-draw numbers understate Node servers specifically, which is the honest
reason the committed figures needed re-measuring rather than defending.

#### Why the worker count is published, and why it is not `nproc`

`concurrencyModel` records `workers` and `cores`, because the comparison is
otherwise silently unfair in both directions. Node is single-threaded, so one
process uses one core, while the Go peers here use `GOMAXPROCS` and the Rust peers
`num_cpus` — every core — by default.

Two things had to be fixed before a worker count meant anything. First,
`node:cluster` defaults to `SCHED_RR`, where the **primary** accepts every
connection and forwards it to a worker over IPC; with keep-alive off that
single-threaded accept loop is the ceiling, and it measured **flat at ~25k req/s
across an 8× concurrency range** — the signature of a serialized accept. Setting
`cluster.schedulingPolicy = SCHED_NONE` lets workers accept for themselves and
roughly doubles it to ~51–56k. (Per-worker `listen({ reusePort: true })` measures
the same, so it buys nothing extra.)

Second, more workers stop helping well before `nproc`, because the load generator
runs on this same box and competes for the same CPUs. Real contract app, `GET /`,
c=256, keep-alive off, median of 3:

| workers |   req/s | per core | speedup |
| ------: | ------: | -------: | ------: |
|       1 |  30,594 |   30,594 |   1.00× |
|       2 |  48,977 |   24,488 |   1.60× |
|       4 |  77,351 |   19,338 |   2.53× |
|       8 | 109,536 |   13,692 |   3.58× |
|      16 |  87,604 |    5,475 |   2.86× |

Throughput peaks at **half the cores** and falls off at all of them, so `run.sh`
defaults `WORKERS` to `cores / 2`; over the full nine-cell matrix that measured
74,390 against 59,523 for `nproc` workers. The Go and Rust peers do take every
core and are not penalised for it, because they need far less CPU per request and
never starve the client — the same asymmetry as the noise above.

Note what the table also says: scaling is **sublinear** — 8× the cores returns
3.58×, and per-core throughput falls monotonically. Node's per-connection cost,
not `@zmdb/web`'s routing, is what does not parallelise here. `WORKERS=1` pins it
to one core for a per-core reading.

### Same-machine, apples-to-apples peer head-to-head

Because "context, different machine" numbers only go so far, `peers/peers-run.sh`
builds and load-tests **17 real peer frameworks on this same box** with the
**identical** `oha` invocation, levels, routes, and duration as `@zmdb/web`, and
verifies each peer's shared contract **before** recording a single number:

| Runtime | Peers                                        |
| ------- | -------------------------------------------- |
| Node    | fastify, hono, express, koa                  |
| Bun     | elysia, hono                                 |
| Deno    | hono, oak                                    |
| Go      | gin, fasthttp, chi, net/http                 |
| Rust    | actix, axum                                  |
| Python  | fastapi (uvicorn), flask + django (gunicorn) |

Each peer is staged **outside** the Corepack/Yarn-PnP monorepo (into `/tmp`) so
its native toolchain behaves normally. Peers whose toolchain/build/contract is
unavailable are recorded as **skipped with a reason — never faked**
(Ruby/Elixir/.NET are out of scope on this machine). Results land in
`peers-results.json` and render on the dashboard as a sortable, per-level,
per-route ranking with `@zmdb/web` highlighted — a genuine head-to-head, kept
**separate** from the "published, different machine" upstream context panel.

```sh
bash benchmarks/harness/framework/peers/peers-run.sh   # all available peers, same knobs
ONLY=fastify,gin,actix bash benchmarks/harness/framework/peers/peers-run.sh
```

> [!WARNING]
> `ONLY=` **replaces** `peers-results.json` with just the peers named. Use it for
> investigation, not to regenerate the published dataset — a partial file drops
> the other rows from the dashboard and mixes measurement sessions.

#### Measured ranking — all 18 on one freshly-booted box, identical knobs

Median across the nine (route × level) cells, `min`/`max` over the three repeats
of the median-selected cell. Every entry re-measured in a single session, so this
is internally comparable in a way the previous single-draw dataset was not.

|  #  | framework     | runtime            | median req/s | min-max spread |
| :-: | ------------- | ------------------ | -----------: | -------------: |
|  1  | actix         | rust (16 cores)    |      151,669 |          1.10× |
|  2  | axum          | rust (16 cores)    |      125,615 |          1.18× |
|  3  | fasthttp      | go (16 cores)      |      117,897 |          1.08× |
|  4  | **@zmdb/web** | **node (8 of 16)** |   **92,993** |      **1.28×** |
|  5  | chi           | go (16 cores)      |       86,549 |          1.30× |
|  6  | net/http      | go (16 cores)      |       84,142 |          1.30× |
|  7  | gin           | go (16 cores)      |       83,421 |          5.11× |
|  8  | hono          | bun                |       71,377 |          1.68× |
|  9  | elysia        | bun                |       70,834 |          1.18× |
| 10  | fastify       | node (1 core)      |       31,943 |          1.44× |
| 11  | hono          | deno               |       31,016 |          5.01× |
| 12  | oak           | deno               |       25,651 |          7.55× |
| 13  | hono          | node (1 core)      |       22,692 |          1.42× |
| 14  | koa           | node (1 core)      |       20,587 |          1.19× |
| 15  | express       | node (1 core)      |       16,519 |          1.23× |
| 16  | flask         | python (gunicorn)  |       16,383 |          1.05× |
| 17  | django        | python (gunicorn)  |       15,047 |          1.03× |
| 18  | fastapi       | python (uvicorn)   |        4,125 |          1.52× |

`@zmdb/web` places **4th of 18** — behind two Rust frameworks and fasthttp, ahead
of the other three Go frameworks, both Bun frameworks, and every other
Node/Deno/Python entry, at **2.9× the fastest peer Node framework**. Note the
spread column: `gin`, `hono-deno` and `oak-deno` were unstable enough (5-7.5×)
that their placement is provisional, which is exactly why the spread is published
rather than only the median.

Read this as a **minimal-HTTP routing** comparison on one machine, not a full-app
verdict (the upstream caveat holds). The separate architectural claim — route
resolution is **init-time, zero per-request reflection** — is machine-checked by
the unit guard in `packages/web/src/bench`, independent of this HTTP harness.

---

## Bottom line (honest)

- **Coverage**: zmdb now serves **all 13 ORM routes (0 DNF)** — joins,
  aggregates, and FTS builders were added (#85/#88, #90/#93, #95/#97) and each
  formerly-DNF route returns HTTP 200 with correct data on real Postgres. One
  caveat: the aggregate routes return a per-order aggregate projection, not the
  parent-joined projection drizzle/kysely emit. Validation: **0 case gaps**.
- **Validation speed**: the AOT path is real and transformer-produced
  (#75/#79–#83) — **~40–100× the runtime path**, beating zod v4 and matching
  typia on parse-safe/assert-loose. After the strict-path fix it is now also
  **competitive with typia on the strict cases** (parseStrict 40M, assertStrict
  42M on Node). Measured across **Node / Bun / Deno** (see dashboard). Shipped
  default is still the runtime path unless the transformer plugin is enabled.
- **ORM speed**: on the **full 13-route k6 run**, zmdb leads on throughput
  (2,491 req/s) and median latency (p50 112ms) but has the **worst tail latency**
  (p95 256ms vs drizzle 207, kysely 220). A real trade-off — **no overall
  "fastest" claim**; results sit within run-to-run noise and the aggregate routes
  use a different projection shape.
