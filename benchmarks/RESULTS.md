# Benchmark Results (real upstream suites, complete accounting)

> zmdb run inside the **actual upstream benchmark harnesses** against **real competitor libraries**. Reproduction: [`harness/`](./harness). Environment: local dev box, Node 26.8.1, real PostgreSQL 16
> (podman).
>
> 📊 **Interactive dashboard** (charts, Node/Bun/Deno tabs): https://ambasta.github.io/zmdb/benchmarks/ — source in [`site/`](./site), built + deployed via GitHub Pages (docs at the root, benchmarks
> under `/benchmarks/`).

---

## Observability overhead — off, API no-op and recording exporter

Measured on 2026-09-05 with Node 26.8.1 on an AMD Ryzen 7 7840U, `@opentelemetry/api` 1.9.1 and `@opentelemetry/sdk-trace-base` 2.11.0. Each row is the median of six samples after 750 ms of warmup per
workload/mode. The runner uses all six mode permutations, placing every mode twice in every ordinal position, and calibrates one 250 ms off-path iteration count that all three modes share.

| workload | configuration      | median ns/op | median ops/s | overhead vs off | exported spans/op | max/min spread |
| -------- | ------------------ | -----------: | -----------: | --------------: | ----------------: | -------------: |
| request  | off                |      1063.65 |       940157 |        baseline |                 0 |         1.034x |
| request  | API no-op          |      3052.11 |       327642 |         +186.9% |                 0 |         1.034x |
| request  | recording exporter |     16337.74 |        61208 |        +1436.0% |                 3 |         1.151x |
| query    | off                |       198.52 |      5037394 |        baseline |                 0 |         1.040x |
| query    | API no-op          |       750.84 |      1331836 |         +278.2% |                 0 |         1.029x |
| query    | recording exporter |      5994.54 |       166819 |        +2919.7% |                 1 |         1.012x |

The request workload consumes one matched `GET` response and exports the server, route and handler spans. The query workload consumes one compiled `SELECT` result through `tracedDriver` and exports
one client span. The recording case is a real `BasicTracerProvider` plus `SimpleSpanProcessor` and a bounded exporter; exporter flush/reset are outside the timed interval, and metrics are disabled in
all three modes. The [raw artifact](./site/observability.json) carries all 36 samples, runtime provenance and a SHA-256 manifest of every benchmark input.

---

## Populated-row validation — full vs shallow depth 1

Measured on 2026-09-04 with Node 26.8.1 on an AMD Ryzen 7 7840U, from a dirty worktree based on `0fb44acc`. The workload rotates eight `PopulatedOrderRow` values; every row has exactly three populated
relation objects (`customer`, `warehouse`, `carrier`) and an `items` list containing 100 rows. Both functions are the real transformer output from `is<PopulatedOrderRow>` and
`isShallow<PopulatedOrderRow, 1>`, not hand-written approximations.

| mode            | median ns/op | median ops/s | max/min spread |
| --------------- | -----------: | -----------: | -------------: |
| full            |     1,325.06 |      754,681 |         1.024x |
| shallow depth 1 |        40.38 |   24,767,110 |         1.025x |

Depth 1 used 2.22% of the full validator's time in this session, a measured 45.07× ratio. It makes a deliberately weaker promise: it checks top-level scalars, relation object shapes and list
array-ness, but not fields inside those relations or list elements. Six semantic probes establish that distinction before timing, including malformed nested fields that full rejects and shallow
accepts.

Each row is the median of six samples after 500 ms of warmup per mode. The runner uses six alternating orders, places each mode three times in each position, observes every boolean result, and refuses
publication above a 1.25× max/min spread. This is one local-machine session, not a cross-machine performance guarantee. The [raw artifact](./site/shallow-validation.json) carries all 12 samples,
runtime provenance and a SHA-256 manifest of every benchmark input.

---

## ORM — drizzle-benchmarks (real methodology: HTTP servers + k6)

This is the upstream method: one **HTTP server per ORM** (each using its own query builder over the same `pg` pool + real Northwind data — 10k customers / 50k orders / 308k order-details), driven by
the upstream **k6** request replay (`data/requests.json`). Servers built from the upstream routes; run via the harness in `harness/orm/`.

**Benchmark config** (like the upstream dashboards, stated for reproducibility):

|          |                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Database | PostgreSQL 16 (podman), same instance for all ORMs                                                                                  |
| Dataset  | Northwind — 10k customers, 200 employees, 1k suppliers, 5k products, 50k orders, **308,224 order_details**                          |
| Driver   | `pg` (node-postgres) pool, `max: 10` — identical across ORMs                                                                        |
| Load     | k6 ramping-VUs 0→200→400, ~25s; full `requests.json` replay (13 routes incl. `/search-*`)                                           |
| ORMs     | drizzle-orm 0.36 (node-postgres), kysely 0.29 (PostgresDialect), zmdb query-compiler                                                |
| Machine  | single local dev box, Node 26.8.1 (server + k6 co-located, so absolute numbers are lower than the upstream 2-machine / 3000-VU rig) |

> ⚠️ Unlike the upstream dashboards (2 machines, 1GB ethernet, ramp to 3000 VUs over ~10 min), this runs server + load on one box with a short ramp — so treat the **relative** ordering as indicative
> and the **absolute** numbers as low.

### Feature coverage — each route listed individually (not summed)

Every upstream route is listed on its own — no scoring, no aggregation into a single number. All 13 are now served (HTTP 200 with correct data); the "why" column records how each formerly-DNF route
was closed.

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

**As originally measured, zmdb served only 7 of the 13 upstream routes** — the 6 join/aggregate/FTS routes were DNF, and in the actual replay those routes are **57.8% of all requests** (the two
100k-request JOIN routes dominate). That was a real, significant feature gap.

> All 13 routes now work against real Postgres. The six routes that originally did not finish were added through the following query-compiler features:
>
> - **FTS** `/search-customer`, `/search-product` — FTS builder (#97).
> - **JOIN** `/employee-with-recipient` (self-join), `/product-with-supplier` — JOIN builder (#88). Repository `findJoined` also passes E2E (#87).
> - **Aggregates** `/orders-with-details`, `/order-with-details` — aggregate builder grouping on the FK in `order_details` (#93); order 10500 → count 15, sum 1038, cross-checked vs raw SQL. Repository
>   `aggregate` passes E2E (#92).
>
> The aggregate routes return `order_id`, `products_count`, and `quantity_sum`. They do not include parent `orders` columns such as `shipName`, so their projection differs from the Drizzle and Kysely
> versions even though the aggregate values match.
>
> Repeated 13-route runs put all three ORMs within a few percentage points on throughput, with the order changing between sessions. Drizzle consistently has the better p95. Enabling server-side
> prepared statements with `ZMDB_PREPARED=1` narrows that tail-latency gap.

### Throughput & latency — k6, FULL 13-route replay (all serve every route, 0 failures)

Full upstream replay (every route, including the heavy `/search-*` full-text queries, 426,999 requests); all three ORMs return 200 on every request. Latency in ms, from the same k6 run (ramp to 400
VUs). p50 omitted — k6 `--summary-export` does not emit it; avg/p90/p95 are the measured percentiles.

| ORM                 |     req/s |      avg |       p90 |       p95 | failed |
| ------------------- | --------: | -------: | --------: | --------: | -----: |
| **zmdb (prepared)** | **3,068** | **97.3** |     179.5 |     209.5 |      0 |
| **zmdb** (default)  |     2,916 |    102.4 |     192.8 |     215.5 |      0 |
| drizzle             |     2,795 |    106.8 | **157.6** | **173.8** |      0 |
| kysely              |     2,733 |    109.3 |     176.8 |     200.8 |      0 |

- **Result:** on this single run zmdb led on **throughput (2,916 req/s)** and **average latency (102 ms)** while **drizzle kept the best tail** (p95 173.8 vs zmdb 215.5).
- **The throughput half of that has since been withdrawn.** These are one sample per ORM in a fixed order with no warmup. Three later sessions of _interleaved_ repeats put the three ORMs within a few
  percent of each other with the ordering flipping between sessions, so the conclusion on throughput is a **tie** — see the bottom line. The tail difference is the part that reproduced.

### Prepared-statement head-to-head (the tail-latency lever, verified)

Same zmdb server with `ZMDB_PREPARED=1` — Postgres caches the query plan server-side (a stable statement name per compiled SQL). Two back-to-back runs:

| run | variant      |     req/s |      avg |       p90 |       p95 |
| --- | ------------ | --------: | -------: | --------: | --------: |
| 1   | default      |     2,916 |    102.4 |     192.8 |     215.5 |
| 1   | **prepared** | **3,068** | **97.3** | **179.5** | **209.5** |
| 2   | default      |     2,903 |    102.8 |     193.7 |     220.3 |
| 2   | **prepared** | **3,010** | **99.2** | **182.6** | **206.5** |

- **Verdict:** `ZMDB_PREPARED=1` reproducibly improves zmdb — **+4–5% req/s, −3–4% avg, ~−11 ms p90, ~−9–14 ms p95.** The tail-latency lever documented as a design mitigation **works empirically**. It
  stays **opt-in** so the default keeps the zero-state (no hidden statement cache) guarantee; drizzle still owns the absolute tail.
- Rankings sit within a few % and can swap run-to-run; the short ramp keeps absolute numbers well below a big-iron run (see config below).

#### Earlier CRUD-subset run (reference, pre-wiring)

Before the join/aggregate/FTS routes were wired, a CRUD-only k6 run (156,999 requests, 0 failures) showed zmdb 6,666 req/s (p95 90ms) · kysely 6,388 (90ms) · drizzle 4,789 (128ms). Superseded by the
full-13 run above.

### Not run here (stated, not faked)

- **Prisma** — DNF (not implemented: engine/codegen not installed).
- Ramp/machine differences vs the upstream 2-machine rig are covered in the **Benchmark config** block above.
- **Not re-measured for the type-first work.** The validator's witness changed from a hand-written descriptor to a generated `TypeIR` across that series of commits, and the validation numbers above
  were re-run for it. These ORM numbers were not, for a checkable reason: the grafted participant ([`participants/orm/src/zmdb-server-node.ts`](./participants/orm/src/zmdb-server-node.ts)) imports
  `@zmdb/query-compiler` and `pg` and nothing else — no repository, no validator — and the only change to `packages/query-compiler` in the whole series is in `migrations/`, which emits DDL and is not
  on this path. A fresh k6 replay would be a new sample of unchanged code, and the interleaved-repeat sessions below already show the run-to-run variance swamping anything that small.

---

## Validation — typescript-runtime-type-benchmarks (upstream runner)

zmdb added as **two** cases in the upstream runner (`ts-node index.ts run …`): `zmdb` (the shipped **runtime** validator) and `zmdb-aot` (the **AOT** path produced by the real transformer). Per-case
ops/s; `DNF` = case the library does not register:

| library                           |   parseSafe | parseStrict | assertLoose | assertStrict | DNF cases              |
| --------------------------------- | ----------: | ----------: | ----------: | -----------: | ---------------------- |
| typia (AOT)                       | 100,673,513 |  38,869,470 |  78,128,590 |   31,056,106 | —                      |
| **zmdb-aot** (transformer-built¹) |  83,288,112 |  55,677,518 |  93,197,945 |   51,735,825 | —                      |
| @sinclair/typebox (JIT)           |         DNF |         DNF |  88,070,252 |   29,157,066 | parseSafe, parseStrict |
| ajv                               |         DNF |         DNF |  43,363,522 |   29,246,420 | parseSafe, parseStrict |
| zod (v4)                          |   8,711,299 |   4,895,742 |   4,173,432 |    4,172,722 | —                      |
| **zmdb** (runtime, shipped²)      |   7,774,947 |   5,147,510 |   7,821,013 |    5,087,724 | —                      |
| arktype                           |         DNF |   3,998,596 |  64,604,434 |    3,983,815 | parseSafe              |
| myzod                             |   3,364,233 |   3,837,054 |         DNF |    3,872,625 | assertLoose            |
| valibot                           |   1,757,211 |   1,370,568 |   1,801,433 |    1,530,501 | —                      |
| zod (v3)                          |   1,087,654 |     970,236 |   1,051,654 |    1,014,129 | —                      |

Only the two zmdb rows were re-measured for this table; the competitor rows are carried forward from the previous full run on the same box. That is sufficient for comparing zmdb variants, but
individual gaps to competitors should not be read as exact.

¹ **`zmdb-aot` numbers come from a generated file that is committed here.** The validators are the output of the real `@zmdb/aot-validator` transform over `harness/validation/aot-source.ts` — four
`is<T>()`/`equals<T>()`/`validate<T>()` calls written the way a user writes them — produced by `yarn bench:validation:generate`, checked in as
[`harness/validation/aot.generated.ts`](./harness/validation/aot.generated.ts), and verified current in CI. Anyone can read the emitted JS and re-derive it.

They replace numbers measured against a **hand-inlined** file whose comment claimed it was what the transformer "WOULD emit". It was not, and the difference is measurable: the hand-written check
skipped the `!Array.isArray(...)` guard at each object level and the `!Number.isNaN(...)` guard on each of the four number fields, and hoisted `deeplyNested` into a local instead of re-reading the
property.

That is why `assertLoose` fell from 108.9M to 93.2M. The skipped work is not optional either — typebox's compiled checker, the closest competitor here, emits `Number.isFinite(value['n'])` and its own
`!Array.isArray(value)`, so the old row was scoring less work against libraries doing more.

² **The `zmdb` runtime row is 5.4× the previous one, and none of that is the walker getting faster.** The witness is now a generated `TypeIR`; it used to be a hand-written `TypeDescriptor`. Measured
today on this box, the same walker over the same shape and the same data:

| witness the walker is given   |     ops/s |
| ----------------------------- | --------: |
| hand-written `TypeDescriptor` | 1,340,445 |
| generated `TypeIR`            | 7,833,292 |

`irFromDescriptor` rebuilt the IR — and with it the reference table keyed on that IR object — on **every call**, so a descriptor input paid a full conversion per validation. Benchmarking it was
benchmarking a compatibility shim over an input form the library never produced, and that front-end has since been deleted outright: the entry points take a `TypeIR` and nothing else.

The previous local row (6.37M, below) was measured before the conversion existed at all, so it is not comparable to either number above — which is the second reason to generate the witness: the
benchmark's input form stopped matching what the library did with it, and nothing said so.

> [!WARNING] The upstream runner discards every result. That used to inflate the hand-inlined AOT rows by 3.3–5× because V8 could remove the pure `void aotIs(FROZEN)` call as dead code. The same
> problem existed in our old local harness.
>
> These Node 26 results use 50 million iterations and the median of five interleaved passes:
>
> | what the loop does                       |     ops/s |
> | ---------------------------------------- | --------: |
> | `void aotIs(FROZEN)` — the old harness   | 1,074.1 M |
> | result observed, input still frozen      |   317.9 M |
> | result observed, input rotates in a pool |   208.7 M |
>
> This affected the comparison unevenly. Zod, Ajv, and Valibot allocate or throw, which prevents their calls from being removed. The ~942M Bun result in footnote ³ came from the same discarded-result
> problem, not from a Bun-specific optimization.
>
> With transformer-generated validators, the upstream results now fall within roughly 15% of the local harness across three sessions: `assertLoose` measured 93.2M upstream and 98.2–107.9M locally,
> while `parseStrict` measured 55.7M upstream and 37.5–50.0M locally. We have not established why V8 keeps these generated calls, so the local harness still consumes every result.
>
> The local harness (`harness/validation`) observes results, rotates inputs, and runs 1,000 validations per timed call so tinybench's ~10ns per-call overhead does not dominate. Use its numbers below
> for comparisons. The upstream table remains as a record of what the upstream runner reports.

### DCE-proof local measurement (`harness/validation`, `./run.sh`)

Node 26, median of 5 passes, 1,000 validations per timed call, results observed, inputs rotating through an 8-object pool. This table is the committed output in
[`harness/validation/validation-results.txt`](./harness/validation/validation-results.txt); `spread` is max/min across the 5 passes within one run.

| library        |  parseSafe | parseStrict | assertLoose | assertStrict |     spread |
| -------------- | ---------: | ----------: | ----------: | -----------: | ---------: |
| typebox (JIT)  |        n/a |         n/a | 114,386,546 |   45,441,197 | 1.05–1.09× |
| **zmdb (aot)** | 73,977,092 |  37,537,637 |  98,179,890 |   37,444,412 | 1.04–1.08× |
| ajv            |        n/a |         n/a |  66,549,461 |   32,373,574 | 1.05–1.07× |
| zmdb (runtime) |  7,021,828 |   4,582,451 |   7,136,217 |    4,689,626 | 1.03–1.09× |
| valibot        |  1,893,780 |   1,491,467 |   1,977,096 |    1,552,091 | 1.04–1.06× |
| zod (v3)       |  1,168,862 |   1,045,898 |   1,171,774 |    1,062,529 | 1.07–1.10× |

Both zmdb rows are generated from the single `Moltar` interface in [`harness/validation/model.ts`](./harness/validation/model.ts) — the runtime row walks the reflected `TypeIR`, the AOT row runs the
transformer's own output — so the two paths measure one declaration instead of two hand-written lookalikes. The previous zmdb rows in this table were both hand-written and neither matched what the
library produces; see footnotes ¹ and ² above for what changed and by how much.

Before it times anything the harness runs all twelve checkers (six libraries × loose/strict) over six probes — accept, top-level excess key, nested excess key, wrong type, empty object,
NaN-as-`number` — and exits non-zero if any disagrees, so the columns compare equal work by construction. That equivalence used to be a sentence here, verified once by hand and then left behind by
every later change to what the strict checkers were.

#### Three sessions, because the absolute numbers drift and the ratios do not

This laptop throttles under sustained load (5.13 → ~2.8 GHz — the same effect that invalidated the framework ranking further down). Three back-to-back sessions, cooling between them, moved every
library's absolute number down together: zmdb-aot `assertLoose` went 107.9M → 103.3M → 98.2M and typebox's 122.8M → 117.7M → 114.4M. So a single-run gap is not a result. The ratios are:

| ratio                         | session 1 | session 2 | session 3 | reading                  |
| ----------------------------- | --------: | --------: | --------: | ------------------------ |
| aot ÷ runtime, `assertLoose`  |    13.79× |    14.18× |    13.76× | stable                   |
| aot ÷ runtime, `assertStrict` |    10.22× |    10.00× |     7.98× | ~8–10×                   |
| aot ÷ typebox, `assertLoose`  |     0.88× |     0.88× |     0.86× | **behind, consistently** |
| aot ÷ typebox, `assertStrict` |     1.08× |     1.02× |     0.82× | **inconclusive**         |
| aot ÷ ajv, `assertLoose`      |     1.55× |     1.53× |     1.47× | ahead                    |
| aot ÷ ajv, `assertStrict`     |     1.42× |     1.32× |     1.16× | ahead                    |
| aot ÷ zod v3, `assertLoose`   |     82.3× |     89.3× |     83.8× | ahead                    |
| aot ÷ zod v3, `assertStrict`  |     42.3× |     43.8× |     35.2× | ahead                    |

The strict rows are the noisy ones, and zmdb's strict path is the more thermally sensitive of the two: it fell 29% across the three sessions where typebox's fell 7%. Whatever the cause, "we lead
typebox on strict" is not something this box can establish, so it is not claimed below.

The strict column did not always compare equal work: typebox's and ajv's `assertStrict` entries once reused their _loose_ checkers (no `additionalProperties: false`), which meant our real excess-key
checking was being scored against four libraries doing none. zod is measured with `safeParse` for the assert cases because it has no allocation-free assert at all, so its assert rows necessarily carry
parse cost.

### What the results show

- **The AOT premise holds, and the multiple is ~8–14×.** Measured DCE-proof, transformer-generated `zmdb-aot` is **8.0–14.2× the `zmdb` runtime** across the three sessions (assertLoose is the stable
  end at 13.8–14.2×, assertStrict the noisy end at 8.0–10.2×) — not the "~40–100×" once claimed here, which was the discarded-result artifact, and not the 10.3–22.2× reported before either: the top of
  that range came from a hand-inlined AOT file doing less work than the transformer emits and a descriptor-fed runtime row doing more. Against zod v3 the emitted code is **35–44× on assertStrict and
  82–89× on assertLoose**, which is the gap that motivated the work.
- **Against a compiled competitor: behind on loose, a tie on strict.** zmdb-aot trails typebox's JIT on `assertLoose` by **1.14–1.17×**, the same deficit in all three sessions. On `assertStrict` the
  ratio moved from 1.08× ahead to 0.82× behind across those sessions, which is far more than the within-run spread, so this box cannot resolve that column at all and no direction is claimed for it.
  Against ajv zmdb-aot is **1.16–1.55× ahead** on both. The earlier "352M ops/s, beats `new Function()` JIT (124M)" claim was measuring eliminated code; static CSP-safe emission is a real
  architectural advantage over runtime `eval`, but it is not a throughput advantage.
- **The loose gap is per-property work the emitter has not optimised.** typebox emits one `Number.isFinite(v['n'])` per number field; zmdb emits `typeof v.n === "number" && !Number.isNaN(v.n)`, and
  re-reads `v.deeplyNested` for each of its three properties instead of binding it once. Both are things the emitter can fix, and neither is visible until the benchmark measures the emitter's actual
  output — which is the argument for generating the file rather than writing what we think it would say.
- **Strict cases: the `for-in` count is real.** This section once described an "inlined `for-in` excess-key count (no `Object.keys()` allocation)" that did not exist. The transformer now emits it
  (`_zmdbExcessMoltar1` in [`aot.generated.ts`](./harness/validation/aot.generated.ts), with an early bail once the count exceeds the field total), against typebox's
  `Object.getOwnPropertyNames(value).length === 2`, which allocates an array per call. That is a plausible reason the strict column comes out closer than the loose one, but the strict column is also
  the unstable one here, so it stays a mechanism and not a measured win.
- **Runtimes matter** — Node/Bun/Deno (see dashboard). The cross-runtime table below is historical: it carries the discarded-result inflation _and_ was measured against the hand-inlined AOT file.
- **The shipped, out-of-the-box path is still the `zmdb` runtime** unless the transformer plugin is enabled. With the plugin, code gets the AOT path. Note what that means for the valid comparison: the
  _default_ install is the ~7.9M ops/s row, behind ajv and typebox and ahead of zod and valibot.

### Cross-runtime (Node / Bun / Deno) — `zmdb-aot`, ops/sec

The full per-library × per-runtime matrix is in the interactive dashboard ([benchmarks/site](./site), published to GitHub Pages). `zmdb-aot` summary:

| runtime |   parseSafe | parseStrict |  assertLoose | assertStrict |
| ------- | ----------: | ----------: | -----------: | -----------: |
| node 26 |  87,600,000 |  44,600,000 |  102,200,000 |   49,900,000 |
| bun 1.4 | 100,600,000 |  40,700,000 | 942,400,000³ |   41,600,000 |
| deno 2  | 174,500,000 |  67,600,000 |  182,000,000 |   60,300,000 |

This table is **historical**: it was measured against the hand-inlined AOT file that footnote ¹ replaces, and has not been re-run against the generated one.

³ Reattributed. This was blamed on Bun's JIT; it is not Bun-specific. The harness was discarding the result, and Node reproduces the same ~1,074M ops/s under those conditions (see the warning above).
Every row in this table carries that inflation to some degree — the AOT rows most of all, because they are the only ones V8 or JSC can delete entirely.

### Where we don't win — gaps & trade-offs

We do **not** win every case in every runtime. The ranking below is from the **upstream runner**, so it carries the discarded-result inflation described in the warning at the top of this section and
should be read as historical rather than current:

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

- **Parse vs typia — untested since the DCE fix.** The ranking table above comes from the upstream runner and inherits its discarded-result inflation, so "leads" in it means "led under a measurement
  that flattered us". The local DCE-proof harness does not include typia (it needs its own AOT transform step), so **we currently have no valid zmdb-vs-typia comparison at all**. Treat every typia
  comparison on this page as unverified until that is fixed.
- **assertLoose — behind typebox.** The "352M ops/s, faster than `new Function()` JIT (124M)" claim was measuring eliminated code. Measured DCE-proof against the transformer's own output, typebox is
  **1.14–1.17× ahead** and it is ahead by that much in all three sessions. Static CSP-safe emission is still the right architecture — no runtime `eval`, works under a strict CSP — but on this case it
  costs throughput rather than winning it. The per-field NaN guard and the un-hoisted nested read are the two known reasons, and both are fixable in the emitter.
- **Strict caps at roughly half the loose rate** — property of excess-key enumeration; every key has to be looked at at least once. The `for-in` count is what got it there (before that rewrite it was
  20.2M and clearly behind), but whether it now leads typebox is **not resolvable on this box**: the ratio ran 1.08× ahead, 1.02× ahead, 0.82× behind across three back-to-back sessions.
- **Runtime default loses to ajv and typebox** — by design; peak needs the AOT plugin. The default install is ~7.8M ops/s assertLoose.
- **ORM tail (p95 256 vs 207) — cause still unknown, and one hypothesis is now ruled out.** Two corrections to what this bullet used to assert. First, the compile step is **~886–993ns, not ~254ns**
  (measured: 993ns for `selectFrom+orderBy+limit+offset`, 886ns for `selectFrom+where+limit`, median of 5 at 200k iterations) — so the figure was ~4× low, though the conclusion it supported survives,
  because even 1µs against a ~112ms round-trip is 0.001%. Second, the "GC variance" part was tested directly and **did not hold**: a compiled query retains only **4–16 bytes**, so compilation is not
  producing the allocation volume that would drive GC pauses. That leaves the tail unexplained rather than explained. It also cannot be closed on the current box — `k6` is not installed and no
  benchmark Postgres is running — so it stays open. Server-side prepared statements remain the plausible lever (opt-in `ZMDB_PREPARED=1`; a plan cache is the planned mitigation, kept opt-in to
  preserve the zero-state guarantee), but that is now a hypothesis, not a diagnosis.

## Framework (HTTP) — the-benchmarker/web-frameworks (real contract + oha)

`@zmdb/web` (the Stage-3 decorator web framework) participates in **[the-benchmarker/web-frameworks](https://github.com/the-benchmarker/web-frameworks)** under its exact shared contract, driven with
the upstream methodology (`oha`, `GET /` 15s, keep-alive disabled, latency-corrected, JSON report; configurable concurrency + routes). Harness: [`harness/framework/`](./harness/framework) (SPEC:
[`framework/SPEC.md`](./harness/framework/SPEC.md)).

### Contract compliance — verified (the RSpec-equivalent check)

The app on port `3000` passes all shared-contract assertions before any load run:

| Method | Route       | Status | Body     | Result        |
| ------ | ----------- | ------ | -------- | ------------- |
| `GET`  | `/`         | 200    | empty    | ✓             |
| `GET`  | `/user/:id` | 200    | the `id` | ✓ (42, 99999) |
| `POST` | `/user`     | 200    | empty    | ✓             |

`contract-check.mjs` → **PASSED — app fulfills the-benchmarker/web-frameworks contract.** The app is built on `@zmdb/web`'s real routing (Stage-3 `@Controller`/`@Get`/`@Post`, `getRoutes` resolved
once at boot, route patterns compiled at boot by `compilePattern` and matched per request by `matchCompiled`).

### Throughput & latency — measured (real oha, `oha` auto-downloaded)

`run.sh` auto-downloads a pinned `oha` prebuilt binary (linux amd64/arm64) when absent, then runs the upstream methodology — concurrency **64/256/512** × the three contract routes, keep-alive
disabled, latency-corrected — and emits `framework-results.json` in the-benchmarker `data.min.json` shape (req/s, average, p50/p75/p90/p99/p99999, totals, `http_errors`, stddev, duration). The shipped
dataset was measured on **Linux x86_64, Node 26.8.1**, every route returning **0 HTTP errors**.

```sh
bash benchmarks/harness/framework/run.sh          # levels 64/256/512, 3 routes, cores/2 workers
REPEATS=5 bash benchmarks/harness/framework/run.sh   # more repeats, tighter spread
WORKERS=1 bash benchmarks/harness/framework/run.sh   # per-core, one process
WORKERS=16 bash benchmarks/harness/framework/run.sh  # every core, as the Go/Rust peers do
```

#### Why each cell is repeated

A single `oha` run of this workload is not a measurement. With `--disable-keepalive` every request opens a TCP connection, so a run's result depends on the kernel's ephemeral-port state — which it
_inherits_ from whatever ran before it. On the reference box ~26k of the 28,231-port range sits in TIME_WAIT under load, and five back-to-back runs of one unchanged binary have been observed spanning
**3.4×**.

So each cell runs a discarded **warmup** (to put the port table in the same state every recorded run will see), then `REPEATS` recorded runs reduced to the **median run** — one real run, so its
percentiles stay consistent with the throughput beside them. `requests_per_s_min` and `requests_per_s_max` publish the spread; under this protocol on a quiet box the same cells reproduce within
**1.01–1.15×**.

This noise is a property of the box, not of any one framework, but it does **not** hit every framework equally, and the asymmetry is the interesting part. Measured in one settled session, the Rust and
Go peers repeated to within 1.004× while the two Node servers — `@zmdb/web` and fastify alike — spanned 1.1–2.5×.

A framework whose per-request cost leaves it far below the box's connection-churn ceiling is insensitive to how much of that ceiling is left; one operating near it is not. So single-draw numbers
understate Node servers specifically, which is the reason the committed figures needed re-measuring rather than defending.

#### Why the worker count is published, and why it is not `nproc`

`concurrencyModel` records `workers` and `cores`, because the comparison is otherwise silently unfair in both directions. Node is single-threaded, so one process uses one core, while the Go peers here
use `GOMAXPROCS` and the Rust peers `num_cpus` — every core — by default.

Two things had to be fixed before a worker count meant anything. First, `node:cluster` defaults to `SCHED_RR`, where the **primary** accepts every connection and forwards it to a worker over IPC; with
keep-alive off that single-threaded accept loop is the ceiling, and it measured **flat at ~25k req/s across an 8× concurrency range** — the signature of a serialized accept.

Setting `cluster.schedulingPolicy = SCHED_NONE` lets workers accept for themselves and roughly doubles it to ~51–56k. (Per-worker `listen({ reusePort: true })` measures the same, so it buys nothing
extra.)

Second, more workers stop helping well before `nproc`, because the load generator runs on this same box and competes for the same CPUs. Real contract app, `GET /`, c=256, keep-alive off, median of 3:

| workers |   req/s | per core | speedup |
| ------: | ------: | -------: | ------: |
|       1 |  30,594 |   30,594 |   1.00× |
|       2 |  48,977 |   24,488 |   1.60× |
|       4 |  77,351 |   19,338 |   2.53× |
|       8 | 109,536 |   13,692 |   3.58× |
|      16 |  87,604 |    5,475 |   2.86× |

Throughput peaks at **half the cores** and falls off at all of them, so `run.sh` defaults `WORKERS` to `cores / 2`; over the full nine-cell matrix that measured 74,390 against 59,523 for `nproc`
workers. The Go and Rust peers do take every core and are not penalised for it, because they need far less CPU per request and never starve the client — the same asymmetry as the noise above.

Note what the table also says: scaling is **sublinear** — 8× the cores returns 3.58×, and per-core throughput falls monotonically. Node's per-connection cost, not `@zmdb/web`'s routing, is what does
not parallelise here. `WORKERS=1` pins it to one core for a per-core reading.

### Same-machine, apples-to-apples peer head-to-head

Because "context, different machine" numbers only go so far, `peers/peers-run.sh` builds and load-tests **17 real peer frameworks on this same box** with the **identical** `oha` invocation, levels,
routes, and duration as `@zmdb/web`, and verifies each peer's shared contract **before** recording a single number:

| Runtime | Peers                                        |
| ------- | -------------------------------------------- |
| Node    | fastify, hono, express, koa                  |
| Bun     | elysia, hono                                 |
| Deno    | hono, oak                                    |
| Go      | gin, fasthttp, chi, net/http                 |
| Rust    | actix, axum                                  |
| Python  | fastapi (uvicorn), flask + django (gunicorn) |

Each peer is staged **outside** the Corepack/Yarn-PnP monorepo (into `/tmp`) so its native toolchain behaves normally. Peers whose toolchain/build/contract is unavailable are recorded as **skipped
with a reason — never faked** (Ruby/Elixir/.NET are out of scope on this machine). Results land in `peers-results.json` and render on the dashboard as a sortable, per-level, per-route ranking with
`@zmdb/web` highlighted — a genuine head-to-head, kept **separate** from the "published, different machine" upstream context panel.

```sh
bash benchmarks/harness/framework/peers/peers-run.sh   # all available peers, same knobs
ONLY=fastify,gin,actix bash benchmarks/harness/framework/peers/peers-run.sh
```

> [!WARNING] `ONLY=` **replaces** `peers-results.json` with just the peers named. Use it for investigation, not to regenerate the published dataset — a partial file drops the other rows from the
> dashboard and mixes measurement sessions.

#### Measured ranking — all 18 on one freshly-booted box, identical knobs

Median across the nine (route × level) cells, `min`/`max` over the three repeats of the median-selected cell. Every entry re-measured in a single session, so this is internally comparable in a way the
previous single-draw dataset was not.

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

> [!WARNING] This table has a position bias. The 18 peers ran one after another while the CPU fell from 5.13 GHz to about 2.8 GHz, so later entries ran on a slower machine. Fastify, which ran early,
> records 31,943 req/s here but 25,441 req/s in the interleaved test below.
>
> The `@zmdb/web` row also came from another session; thermal conditions alone have moved the same code between 76,871 and 93,647 req/s. Use this table only for broad runtime tiers. The interleaved
> per-core table below is the meaningful JS/TS comparison. The original values remain here so the published dataset is not silently rewritten.

The old reading of this table — "**4th of 18**, at **2.9× the fastest peer Node framework**" — was wrong, and not by a little. It compared `@zmdb/web` on **8 worker processes** against peers on
**one**, which is 8× the hardware, and across sessions on a CPU whose clock moves by 1.85×. Per core and interleaved, the real margin over fastify is **1.17×**.

Note the spread column too: `gin`, `hono-deno` and `oak-deno` were unstable enough (5–7.5×) that their placement was never meaningful, which is why the spread is published rather than only the median.

#### The real head-to-head — our own language class, per core, interleaved

The question this actually answers is "are we the fastest JS/TS framework". To make that answerable on throttling hardware, all 12 candidates are measured in **one experiment where every pass visits
every candidate once and the visiting order rotates between passes**, so no candidate holds a favourable slot in the thermal ramp. `GET /` at c=256, keep-alive off, 10s, **median of 5 passes**. The
CPU clock is sampled before every single measurement and stored beside it.

|  #  | framework                    | runtime  | per-core req/s | pass spread |
| :-: | ---------------------------- | -------- | -------------: | ----------: |
|  1  | elysia                       | bun      |         64,507 |       1.10× |
|  2  | hono                         | bun      |         58,508 |       1.11× |
|  3  | hono                         | deno     |         52,413 |       1.13× |
|  4  | **@zmdb/web**                | **bun**  |     **51,248** |   **1.14×** |
|  5  | **@zmdb/web**                | **deno** |     **44,230** |   **1.25×** |
|  6  | oak                          | deno     |         38,380 |       1.04× |
|  7  | **@zmdb/web**                | **node** |     **29,698** |   **1.03×** |
|  8  | @zmdb/web (hand-written app) | node     |         27,930 |       1.08× |
|  9  | fastify                      | node     |         25,441 |       1.08× |
| 10  | hono                         | node     |         22,385 |       1.07× |
| 11  | koa                          | node     |         20,099 |       1.10× |
| 12  | express                      | node     |         16,440 |       1.09× |

By runtime:

- **On Node we lead the class.** 29,698 against fastify's 25,441 (**1.17×**), hono's 22,385 (1.33×), koa (1.48×) and express (1.81×). Both spreads are ≤1.08×, so the margin is outside the noise.
- **On bun we are third of three.** 51,248 against elysia's 64,507 (**0.79×**) and hono's 58,508 (0.88×). Both of them are on `Bun.serve` with a fetch handler, same as we now are, so this gap is ours
  — it is in the dispatcher, `Ctx` construction and `Response` construction, not in the serving API.
- **On deno we are second of three.** 44,230 against hono's 52,413 (**0.84×**), ahead of oak's 38,380 (1.15×).

That is the actionable finding: **the remaining gap is bun/deno-side pipeline cost, not the runtime binding and not Node's HTTP stack.**

Read this as a **minimal-HTTP routing** comparison on one machine, not a full-app verdict (the upstream caveat holds). The separate architectural claim — route resolution is **init-time, zero
per-request reflection** — is machine-checked by the unit guard in `packages/web/src/bench`, independent of this HTTP harness.

#### Where the gap to actix actually is — a layer budget

Before optimizing the framework, first identify how much of the request it controls. Same box, 8 workers, `GET /`, keep-alive off, c=256, median of 3, each layer adding one thing to the one above it:

| layer                                  |   req/s |                                 that layer's cost |
| -------------------------------------- | ------: | ------------------------------------------------: |
| raw TCP (`net`, canned response bytes) | 152,748 |                          libuv accept/close floor |
| bare `node:http`, `res.end()`          | 114,438 |             −38,310 (25%) parser + stream objects |
| bare `node:http` + `writeHead({…})`    | 103,407 |              −11,031 (10%) serialising one header |
| the contract app                       | 102,651 | **−756 (0.7%)** routing + controller + validation |

**actix's 151,669 is the 152,748 raw-socket floor.** It is running at the rate this machine can accept and close TCP connections, and there is no layer above it to reclaim. Meanwhile everything
`@zmdb/web` does — bucket lookup, pattern match, controller dispatch, AOT validation — is **0.7% of the budget**, and `node:http` is 25%.

So the distance to the Rust frameworks is not a design problem in this package; it is the cost of Node's HTTP stack, and no amount of tuning inside the framework can pay for it.

Header strategy is a dead end too: of five variants measured, inline `writeHead` (91,302), a hoisted object (89,843) and a raw array (91,244) are indistinguishable, `setHeader`-per-entry is worse
(78,962) and sending none at all is 97,458 — the cost is Node serialising the header, not allocating the object.

> [!NOTE] The contract app now uses the same public API as a consumer. Its earlier version used real decorators, route matching, and AOT validation, but bypassed the framework dispatcher, adapter,
> validation hook, and response helpers by calling `res.writeHead` and `res.end` directly.
>
> At the time, `Router.handle` always returned `jsonResponse(200, result)`. A handler could not choose a status, add a header, or return plain text. The benchmark contract requires `GET /user/0` to
> return the single byte `0`, not the JSON string `"0"`. The `json()`, `text()`, and `respond()` helpers in `packages/web/src/pipeline` added that missing control. The harness now measures
> `createRouter` and `toNodeHandler` end to end.
>
> Five rotated, interleaved, per-core passes measured the public-API app at **29,698 req/s** and the hand-written app at **27,930 req/s**. Their pass spreads were 1.03× and 1.08×. The difference is
> too small to distinguish from run-to-run variation, so this experiment found no detectable overhead from the public dispatcher and adapter.
>
> This replaces the earlier 17% estimate, which compared 92,993 and 76,872 req/s from separate sessions on a CPU whose clock varies by 1.85×. It also agrees with the layer budget above, where
> framework work accounted for 0.7% of the request.
>
> We also checked roughly 75 vendored JS/TS implementations. Framework-based entries register routes and let the framework write the response. Direct byte writes appear only in `vanilla_*` entries and
> routerless primitives such as hyper, may_minihttp, polkadot, and pxe. Our old harness was the only JS framework entry that bypassed its own response path.
>
> The contract checks exact response bytes, not `Content-Type`. `route_spec.rb:28`, for example, requires exactly `0`.

#### Runtimes — and the serving API that matters more than the runtime

`RUNTIME=node|bun|deno` picks which runtime serves the app; the app is bundled once and all three run the same bundle, so the runtime is the only variable. Measured in **one continuous session**, 15s
× 3 repeats, median of the nine (route × level) cells:

| runtime | 8 of 16 workers | 1 worker (per core) | worst cell spread |
| ------- | --------------: | ------------------: | ----------------: |
| bun     |     **145,628** |          **59,672** |             1.22× |
| deno    |         124,839 |              53,879 |             1.25× |
| node    |          93,647 |              26,172 |             1.30× |

The finding is not the ranking, it is **how the app listens**. Under bun and deno, `createServer(toNodeHandler(router))` works — through their `node:http` _compatibility_ layer, which is not what
either runtime is fast at. `@zmdb/web` also exports `toFetchHandler`, a plain `Request → Response` function, which is exactly what `Bun.serve` and `Deno.serve` want. Switching to it:

| runtime, workers | via `node:http` compat | via native `serve` + `toFetchHandler` |  gain |
| ---------------- | ---------------------: | ------------------------------------: | ----: |
| bun, 8           |                 91,386 |                               145,628 | 1.59× |
| bun, 1           |                 43,266 |                                59,672 | 1.38× |
| deno, 8          |                 46,990 |                               124,839 | 2.66× |
| deno, 1          |                 20,553 |                                53,879 | 2.62× |

`toFetchHandler` is public API and is what hono, elysia and oak use on these runtimes, so this is like-for-like rather than a special case built for the benchmark — and both variants pass the
byte-exact contract, which is the proof that `text()` / `respond()` work through the Fetch adapter as well as the Node one. Node has no equivalent to switch to; `createServer` is the only path there.

> [!CAUTION] **Between-session drift on this box is ~20%, and it invalidates cross-session comparisons — including some we previously published.** The identical Node code path medianed **76,871** in
> one session and **93,647** in another, 8 of 9 cells higher, while the _within_-session repeat spread was only ~3%. So a 15% margin between two numbers taken hours apart establishes nothing, no
> matter how many repeats each one had. Every comparison in the two tables above comes from a single uninterrupted block for that reason, and the compat-vs-native gains are quoted only because
> 1.38–2.66× is far outside the drift.

---

## Bottom line

- **HTTP speed, per core, against our own language class**: we **lead on Node** (29,698 req/s vs fastify 25,441 — 1.17×, and 1.33× hono, 1.81× express), are **third of three on bun** (51,248 vs elysia
  64,507 and hono 58,508), and **second of three on deno** (44,230 vs hono 52,413, ahead of oak 38,380). So: benchmark leader of the JS/TS class on Node, not yet on bun or deno. All twelve candidates
  interleaved with rotating order, median of 5 passes, spreads ≤1.25×.
- **Runtime choice beats framework tuning here**: the same app does 93,647 req/s on node, 124,839 on deno and 145,628 on bun at 8 workers. Most of that came from serving via `toFetchHandler` +
  `Bun.serve`/`Deno.serve` instead of those runtimes' `node:http` compatibility layer — worth **1.59× on bun and 2.66× on deno**, and both public API.
- **Going through the public API cost nothing**: hand-written `res.end` vs `createRouter` + `toNodeHandler`, interleaved, is 27,930 vs 29,698 — inside the noise. An earlier "17% cost" was a
  cross-session thermal artifact and is withdrawn.
- **Measurement integrity is now the binding constraint on this box, not the code**: it throttles 5.13 → ~2.8 GHz under sustained load, so the identical code path medianed 76,871 and 93,647 in two
  different sessions. Anything sequential is biased toward whatever ran first, which invalidated the 18-framework ranking's margins and the two claims above. Interleaved, order-rotated passes are the
  fix and are what every comparison here now uses.
- **Coverage**: zmdb now serves **all 13 ORM routes (0 DNF)** — joins, aggregates, and FTS builders were added (#85/#88, #90/#93, #95/#97) and each formerly-DNF route returns HTTP 200 with correct
  data on real Postgres. One caveat: the aggregate routes return a per-order aggregate projection, not the parent-joined projection drizzle/kysely emit. Validation: **0 case gaps**.
- **Validation speed**: the AOT path is real, and the file measured is the transformer's own output, generated from one interface and committed (#75/#79–#83) — **8–14× the runtime path** measured
  DCE-proof, and 35–44× (strict) to 82–89× (loose) zod v3 on the assert cases. Against a compiled competitor: **1.14–1.17× behind typebox on assertLoose in every session, and assertStrict too unstable
  here to call** (1.08× ahead → 0.82× behind across three sessions). The previously published "~40–100×" and the typia comparisons came from a harness that discarded results and so deleted our
  validator's calls outright; there is currently **no valid zmdb-vs-typia comparison**. Shipped default is still the runtime path unless the transformer plugin is enabled.
- **ORM speed**: **tied with kysely and drizzle** on the full 13-route k6 run. Three sessions of interleaved repeats, each ORM's overall median req/s:

  | session                   |      zmdb |    kysely | drizzle | leader's margin |
  | ------------------------- | --------: | --------: | ------: | --------------: |
  | RUN2                      | **3,927** |     3,701 |   3,625 |      zmdb +6.1% |
  | RUN3                      | **3,628** |     3,532 |   3,222 |      zmdb +2.7% |
  | RUN4 (freshly-booted box) |     3,827 | **4,012** |   3,654 |    kysely +4.8% |

  The ordering **flips between sessions** and every margin is a few percent, against a worst per-cell spread of 43% in the same data — so the conclusion is a tie, not a win. This replaces the earlier
  "zmdb led at 2,491 req/s", which was one sample per ORM taken in a fixed order with no warmup.

- **The one ORM defect the repeats did find was real and is fixed**: `order-with-details-and-products` was building a cross product where the peers build two left joins. Its p95 went **183.2ms →
  ~122–124ms** and it is no longer an outlier among the 13 routes.
- **What is left is variance, not throughput**: across passes zmdb's own req/s spread is **1.43×**, against drizzle 1.07× and kysely 1.11×. We are the least stable of the three by a wide margin, and
  that — not the median — is the next lever. Leading suspect is per-request SQL compilation with no cached compiled text (`ZMDB_PREPARED=1` exists and was unset for all three sessions).
