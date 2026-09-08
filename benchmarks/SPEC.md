# Benchmarking harness and engineering cost contract

The existing runtime harnesses and result definitions remain authoritative. Section 8 freezes the engineering cost contract for the later #738 measurement children; it does not claim those runners or
measurements already exist. The top-level `benchmarks/` workspace is never published.

## 1. Workspace layout

```
benchmarks/
├── SPEC.md                 # this file
├── src/
│   ├── results.ts          # Result type + schema validator + report helpers
│   ├── validation/         # moltar-style validation suite adapter + runner (#70)
│   └── orm/                # drizzle-style ORM suite adapter + seed + runner (#71)
├── harness/
│   ├── validation/         # the actual moltar suite participation
│   ├── orm/                # the actual drizzle-benchmarks HTTP+k6 participation
│   └── framework/          # the actual the-benchmarker/web-frameworks participation (@zmdb/web)
├── RESULTS.md              # generated comparative report (#72)
└── results.json            # generated machine-readable results (#72)
```

## 2. Result definitions and evidence boundary

[`BenchResult`, `ResultStatus`, `IN_SCOPE_CASES`, `validateResult` and `validateCoverage`](./src/results.ts) are the canonical validation/ORM result definitions. Do not maintain a second interface
here. The [framework harness contract](./harness/framework/SPEC.md) owns its HTTP workloads, runtime variants and raw/report formats.

- An `ok` validation/ORM result carries throughput; a `dnf` result carries a non-empty reason.
- Every in-scope case appears for every target, including refusals; missing and duplicate cases do not count as coverage.
- These result rows are report projections. Passing their validator does not establish engineering-cost provenance or statistical validity under section 8. Do not encode editor milliseconds as
  throughput or invent a parallel result schema: later runner work extends the existing result owner when a new machine-readable representation is necessary.

## 3. DNF reason taxonomy (frozen)

- `dnf (anti-pattern): <detail>` — the case only makes sense for a pattern zmdb rejects (identity map, proxy lazy-load, active-record save). Permitted to skip execution but MUST still appear as a DNF
  row.
- `dnf (not implemented): <detail>` — a supported-in-principle case we have not wired yet. MUST appear as a DNF row until implemented.

## 4. Validation case matrix (moltar) — suite `validation`

| case id         | definition                     | zmdb entry point                  | expected status |
| --------------- | ------------------------------ | --------------------------------- | --------------- |
| `safe-parse`    | validate + strip excess keys   | `parse<T>` (strip)                | ok              |
| `strict-parse`  | validate + reject excess keys  | `parse<T>` (strict) / `equals<T>` | ok              |
| `loose-assert`  | assert, allow excess           | `is<T>` / `assert<T>`             | ok              |
| `strict-assert` | assert, reject excess (nested) | `assertEquals<T>`                 | ok              |

Competitors: typia, zod, @sinclair/typebox, ajv. All four cases are in scope for zmdb.

## 5. ORM case matrix (drizzle) — suite `orm`

| case id               | definition                   | zmdb path                           | expected status    |
| --------------------- | ---------------------------- | ----------------------------------- | ------------------ |
| `customer-by-id`      | point lookup by PK           | `findById`                          | ok                 |
| `products-search`     | filtered list + pagination   | query-compiler where/limit/offset   | ok                 |
| `order-with-items`    | nested order + line items    | relations `populate` (JOIN/batched) | ok                 |
| `top-products`        | aggregation (group/count)    | query-compiler aggregate SQL        | ok                 |
| `prepared-reuse`      | reuse a prepared statement   | `CompiledQuery` reuse               | ok                 |
| `lazy-relation-graph` | proxy lazy-load traversal    | —                                   | dnf (anti-pattern) |
| `identity-map-dedup`  | shared refs within a request | —                                   | dnf (anti-pattern) |
| `active-record-save`  | `entity.save()` mutation     | —                                   | dnf (anti-pattern) |

Competitors: drizzle, prisma, kysely.

## 6. Determinism & reproducibility

- Pinned dataset size + pinned competitor versions.
- Isolated processes per target (matches moltar's methodology).
- Report output has stable ordering (by suite, then case, then target).

## 7. Non-goals (rejected)

- Benchmarking anti-pattern-only capabilities as if we supported them.
- Silently dropping any in-scope case (must be DNF instead).

## 8. Engineering cost contract (#739)

This section is the shared authority for cost accounting and comparative acceptance. Existing harness contracts retain their correctness oracles, payloads and output definitions. The sampling defaults
below apply to future engineering-cost comparisons and do not retroactively qualify old reports. No new gate or measurement runner is introduced by this contract.

### 8.1 Frozen inputs and workload boundaries

Use the existing [default product consumer](../fixtures/consumer-product/) and [HTTP plus selected-worker consumer](../fixtures/consumer-server-core/) as separate application workloads. Keep the
[existing type-instantiation workload](../.github/scripts/verify-instantiations.mjs) and [multi-module build workload](../.github/scripts/build-budget.mjs) as distinct compiler stress cases. Runtime
operations come from the validation/ORM matrices above and the [framework harness](./harness/framework/SPEC.md); an HTTP-only score is not a validation score.

Before collecting comparative data, pin each workload's source/configuration hashes, exact operation trace, input size, selected public entry, correctness oracle and cache policy. The same workload
runs against baseline and candidate; an API migration that needs different source must retain both hashes and explain the equivalent operations. Freeze parameters before seeing candidate results. Do
not choose an easier fixture, omit a target, or change a budget after observing a slow result.

| Bucket / workload                  | Start, stop and required state                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor / cold load                 | Start a new editor language-service process with the pinned project; stop when project loading and initial diagnostics complete. Dependencies are already installed; no prior editor project state is retained.                                                                                                                                   |
| Editor / interactive replay        | In a loaded project, replay completion at a schema-tag import and repository member, quick-info for a derived DTO and repository result, and diagnostics for a valid edit, an invalid payload edit and its undo. Pin request positions and edit bytes; require the expected answers and diagnostic transitions. Report each operation separately. |
| Type-check / clean                 | Remove only the workload's checker cache/build-info, run its exact strict compiler command and consume its diagnostics and exit status. Record elapsed time, peak memory and available checker counters.                                                                                                                                          |
| Type-check / no-change incremental | Prime the same project once, retain its checker state, make no edit, then measure the next check. Priming cost is retained as a separate clean-check observation.                                                                                                                                                                                 |
| Type-check / affected edit         | From the same primed state, apply one pinned public schema edit and measure checking through its affected consumers. Check the expected diagnostics, then restore the input before another trial.                                                                                                                                                 |
| Type-check / packed declarations   | Check the actual installed public consumer with its strict settings and resolved dependencies, without workspace source paths or declaration checking bypasses. Installation is measured separately.                                                                                                                                              |
| Build / clean and cached           | Run the real compiler/AOT and declaration build from installed dependencies. Clean trials remove owned outputs and build caches; cached trials retain a completed build and make no source edit. Consume the emitted program/artifacts and record bytes as well as time and peak memory.                                                          |
| Distribution / pack                | Pack the same completed build through the real package manager. Retain the actual archive, integrity hash, compressed/unpacked sizes and package listing; build time remains in its own cell.                                                                                                                                                     |
| Distribution / install             | Install those archives and their declared dependencies into an external consumer with a frozen lockfile. Measure an empty private package cache and a populated-cache clean install separately; record installed bytes and the resolved dependency tree. Pin the registry/network policy, lifecycle scripts and package-manager flags.            |
| Startup / import and readiness     | Start a fresh process on emitted, installed code; measure process launch to public import completion and application readiness separately. Include module resolution, initialization and required connection setup; do not hide them in preparation.                                                                                              |
| Startup / first operation          | On that newly ready application, issue the first valid HTTP request or query, check the result, and record its latency separately from readiness. State whether the database/server and its caches were cold or warm.                                                                                                                             |
| Runtime / steady state             | Execute each real validation, SQL, persistence and HTTP operation at its pinned payload, database state, concurrency and load duration. Report latency/throughput, allocations when measured, memory and errors per operation; consume the results.                                                                                               |

“Cold” names the state actually reset; a fresh process is not a claim that the OS page cache or database server is cold. Keep cache variants separate. Record preparation and owned teardown in the
bucket that pays for them, outside the named primary interval when appropriate. A result that skips work, fails its correctness oracle or leaves owned resources behind is invalid, regardless of speed.

### 8.2 Raw evidence and provenance

Retain every timed observation, warm-up and rejected trial, not just a chart or median. Each observation must resolve unambiguously to its workload, target, phase, order/seed, timestamp, cache state,
command/flags, exit status, correctness result and units. Retain the original tool output, diagnostics, load-generator output and dependency tree; keep rejection reasons beside the raw samples.

The evidence must include:

- Exact source revision plus dirty/input hashes, fixture/edit/config hashes, lockfile hash, emitted artifact/archive hashes and the resolved versions of all dependencies used by the workload.
- Hardware model/architecture, CPU/core allocation and frequency policy, RAM, storage/filesystem, OS/kernel, runtime, compiler, package manager and measurement-tool versions; record relevant
  container, power/thermal and background-load conditions.
- Sanitized environment and commands, registry/network policy, process topology, worker/concurrency counts, database version/dataset/seed, warm-up and reset procedures, timer/memory sampling method
  and measurement resolution. Never retain credentials in evidence.
- Baseline and candidate identities, predeclared metric/budget choices and the transformation from raw samples to the reported result, including the analysis version and random seed.

Missing input hashes or resolved dependency versions invalidate a comparative claim. Reports link to retained raw evidence; a report projection or successful exit alone is insufficient. A changed
machine, runtime, compiler, workload or cache condition creates a separate cell, not another repetition in the same sample.

### 8.3 Balanced sampling and noise

Use one machine/environment per comparison cell. Interleave baseline and candidate in balanced AB/BA order; for multiple targets, rotate order so each occupies every position equally. Record the order
and seed. Do not run competing measurement cells concurrently or compare sequential blocks from different thermal conditions.

Default to at least **20 independent observations per target and cell**, balanced in complete rounds. Each observation uses a fresh process/session and the required reset or priming procedure. Do not
count individual requests or repeated actions within one process as independent repetitions. Retain their distributions, but resample whole observations for uncertainty.

Cold/startup trials have no hidden warm-up. Prime incremental/cached workloads once using the stated complete workload. For interactive editor timings, replay the fixed trace three times before its
measured replay. For steady-state runtime, use a fixed five-second warm-up followed by the upstream workload's timed window, at least 15 seconds; retain warm-up evidence separately. A harness-mandated
different procedure must be declared before measurement, applied equally and labelled as a separate variant.

Do not trim slow observations as outliers. Reject only a predeclared invalid trial, such as a failed correctness/reset check, process failure or observed interference; retain it and rerun the entire
balanced round. Thermal drift or unresolved environment changes make the comparison inconclusive, not evidence for selecting the fastest run. Publish the raw spread beside the median.

### 8.4 Per-workload budgets and regression decisions

Each required workload and metric is a separate acceptance cell. Before sampling, record any applicable absolute limit and a baseline; retain existing deterministic compiler/structural limits from
their owning guards. The default comparative thresholds are **5%** for median elapsed time, inverse throughput, peak memory and artifact/installed size, and **10%** for p95/p99 latency. A stricter
existing limit still applies. Different thresholds require an explicit workload-specific decision before the campaign, not a change made to pass observed results.

For sampled metrics, report the paired candidate/baseline cost ratios and their median with a **95% pointwise bootstrap interval**, using **10,000 resamples** of complete paired observations and a
recorded seed. Throughput is converted to inverse throughput for the ratio so that a larger value always means more cost. These are per-cell intervals, not a claim of simultaneous confidence across
all workloads. Deterministic sizes/counters are compared directly; confidence intervals cannot excuse a hard-limit violation.

- A cell passes only when its absolute limits hold and the entire interval is at or below its allowed slowdown. A deterministic metric passes only within its limit.
- An interval entirely above the threshold is a regression. An interval crossing the threshold, missing repetitions, or unresolved noise is inconclusive and cannot be labelled a pass.
- One over-budget required cell prevents a passing overall claim. Runtime gains cannot offset compiler, editor, startup or install regressions; neither can an average hide a slow operation or tail.
- Accepting a measured regression requires a recorded decision for that exact bucket/workload/metric, with its raw evidence, rationale, scope, owner and follow-up or revised budget. Report it as an
  accepted regression, not an unchanged-budget pass. Preserve the original failing result.

### 8.5 CI smoke, final campaigns and non-blocking work

Deterministic CI smoke exercises the pinned workload, consumes its outputs, checks correctness and cleanup, and enforces its existing committed structural/count/size bounds. Finite timeouts protect
execution; a timeout is a failed run, not a measured latency. Record elapsed diagnostics without presenting shared-runner wall time as a comparative performance claim. This contract adds no universal
performance gate or new smoke budget inferred from an unmeasured machine.

Release comparisons require the raw provenance, independent balanced repetitions and per-cell decisions above on the complete product. Run the final comparative campaign only in the dedicated
benchmark child **after all non-benchmark sub-issues are complete**. Earlier smoke or exploratory observations remain labelled as such and cannot be promoted to final release evidence.

Pending benchmark implementations or final measurements do not block unrelated non-benchmark implementation work. A release performance claim still waits for its required valid evidence; a missing or
inconclusive cell is not zero cost, an implicit pass, or permission to substitute an aggregate score.
