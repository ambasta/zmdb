# Benchmark reproduction

zmdb run as a participant in the **exact upstream benchmark suites**, against real installed competitor libraries. Authoritative results: [`../RESULTS.md`](../RESULTS.md). Rendered dashboard:
`site/benchmarks/index.html` after `yarn build:docs`.

## The short version

```sh
git submodule update --init --depth 1   # the three upstream suites
yarn bench                              # graft zmdb in, measure, normalise
yarn build:docs                         # render the dashboard
```

`yarn bench` takes the suites one at a time and prints, for each, either the measurement or the precondition that is missing. It never fills a gap with a zero — a suite that could not run is reported
as not run, and the dashboard shows that instead of a number.

| Command                                       | What it does                                              |
| --------------------------------------------- | --------------------------------------------------------- |
| `yarn bench`                                  | all three suites, then normalise                          |
| `yarn bench:validation`                       | moltar suite only, installing its dependencies            |
| `yarn bench:orm`                              | drizzle-benchmarks only (needs `k6` + `DATABASE_URL`)     |
| `yarn bench:framework`                        | web-frameworks contract + `oha` load, plus every peer     |
| `yarn bench:normalize`                        | re-derive the dashboard JSON from results already on disk |
| `yarn bench:graft` / `yarn bench:graft:check` | apply / verify the graft without measuring                |
| `yarn bench:validation:generate`              | regenerate the validation model's two generated modules   |

## How zmdb gets into someone else's suite

The three suites are git submodules under [`../upstream/`](../upstream). Nothing in them is edited by hand. `../scripts/graft.mjs` combines two kinds of change, kept separate on purpose:

- **[`../participants/`](../participants)** — whole files that are ours (a case, a server, a framework directory). Copied into the submodule. No conflict is possible, so bumping a submodule can never
  break them.
- **[`../patches/`](../patches)** — the minimal edits to upstream's own files: registering the participant in a list, adding a compile script. Applied with `git apply --3way`, which survives unrelated
  drift and fails loudly on real drift rather than half-applying. If a patch stops applying, `graft.mjs` says so and prints the command that regenerates it.

None of this is meant to be upstreamed: the participants import this repository's sources by relative path, which only resolves from inside the submodule checkout. `graft.mjs --clean` returns every
submodule to pristine.

## Validation — moltar/typescript-runtime-type-benchmarks

Two participants, deliberately not one:

- **`zmdb`** — the runtime validator walking a `TypeIR`. No transformer.
- **`zmdb-aot`** — the same public API with `@zmdb/aot-validator`'s transformer applied.

Reporting them separately is the point: collapsing them into one row would let the AOT number stand in for the runtime path that most callers get by default.

Both participants are three lines of re-export. What they re-export comes from `../scripts/generate-validation-model.mjs`, which reads the one `Moltar` interface in
[`validation/model.ts`](./validation/model.ts) and writes two generated modules next to it:

| generated file       | what it is                                                     |
| -------------------- | -------------------------------------------------------------- |
| `model.generated.ts` | the `TypeIR` the runtime walker reads, from `Reflector.typeIR` |
| `aot.generated.ts`   | the inlined functions, from the real `transformFile`           |

Both come off the same `is<Moltar>(...)` call site, so the two rows cannot end up describing different shapes, and the generator refuses to write anything if the source has a semantic error, if the
reflection declines a type, or if the transform leaves a generic call in place. Run it with `yarn bench:validation:generate`; CI runs `yarn bench:validation:generate:check`, which fails on drift,
because a stale generated file means the published numbers describe a shape nobody declared.

The AOT participant used to be a hand-inlined file whose header claimed it was "EXACTLY as zmdb's transformer WOULD emit". It was not, and the difference was worth 15% on `assertLoose` — see footnote
¹ in [`../RESULTS.md`](../RESULTS.md).

Before it times anything, `validation/validation.bench.ts` runs all twelve checkers (six libraries × loose/strict) over six probes — accept, top-level excess key, nested excess key, wrong type, empty
object, NaN — and exits non-zero if any of them disagrees. A speed table for checkers that answer differently is not a comparison, and that equivalence used to be a sentence in RESULTS.md rather than
something the harness enforced.

One caution on reading its output: this box throttles under sustained load, and the top of this field is fast enough to notice. Three back-to-back sessions moved every library's absolute number down
together by ~8%, and moved the zmdb-aot-vs-typebox `assertStrict` ratio from 1.08× ahead to 0.82× behind — far more than the within-run spread the harness prints.

So a gap between two fast libraries needs more than one session before it means anything. `REPEATS=9 ./run.sh` widens the median within a session; it does not help with drift across sessions, which is
why RESULTS.md publishes the ratios per session instead of one number.

```sh
yarn bench:validation                              # whole field
node benchmarks/scripts/bench.mjs validation --libs=zmdb,zmdb-aot,typia,zod,valibot
yarn bench:validation:generate                     # refresh the three generated modules
cd benchmarks/harness/validation && ./run.sh       # the DCE-proof local harness
```

### Populated-row full vs shallow validation

The focused shallow benchmark uses a separate `PopulatedOrderRow` declaration with exactly three populated relation objects (`customer`, `warehouse`, `carrier`) and an `items` list containing 100
rows. The generator writes `validation/shallow.generated.ts` from public `is<PopulatedOrderRow>` and `isShallow<PopulatedOrderRow, 1>` calls, and the benchmark imports only that transformer output.

```sh
bash benchmarks/harness/validation/run-shallow.sh
bash benchmarks/harness/validation/run-shallow.sh --write-final
```

The default command prints diagnostic JSON. `--write-final` writes `site/shallow-validation.json` only when both modes stay within the declared 1.25× max/min spread ceiling. Every run first checks six
semantic probes, rotates through eight distinct populated rows, observes every boolean result, and uses six balanced orders so each mode appears three times in each position. The final artifact
records all 12 raw samples, runtime provenance, and a SHA-256 manifest of every benchmark input; `yarn verify:bench` recomputes the manifest and the published summary rows.

`--libs` also filters the normalisation step, so a partial run rewrites the dashboard JSON with only the libraries it measured. To refresh a couple of rows without dropping the rest, run with
`--libs=…` and then `yarn bench:normalize`.

Two things about the install: npm 12 refuses `remote`-type dependencies, and upstream pins `@paseri/paseri` to a JSR tarball URL, so the install needs `--allow-remote=all` (`bench.mjs` passes it).
Corepack also refuses to run npm anywhere under a repository whose `packageManager` says yarn; the submodules are not part of this workspace, so `bench.mjs` sets `COREPACK_ENABLE_STRICT=0` for them.

The upstream runner catches a case that fails to build and moves on, leaving no row in `docs/results/node-<major>.json`. `bench.mjs` records the requested set minus the measured set as `notRun`, and
the dashboard lists those libraries by name — otherwise a build failure elsewhere would read as an absence of competition.

## ORM — drizzle-team/drizzle-benchmarks

The upstream benchmark runs **one HTTP server per ORM** and drives them with **k6** replaying `data/requests.json`. `../participants/orm/src/zmdb-server-node.ts` mirrors `src/drizzle-server-node.ts`
route for route: same Hono app, same cpu-usage endpoint, same `cluster.fork()` across every core, same pool geometry (`min: 10, max: 10`). What differs is only how each route's SQL is produced. zmdb
names every statement so Postgres caches the plan, because the drizzle participant calls `.prepare()` on every query and without that the comparison would measure planning rather than either library.

zmdb serves **all 13 routes**. It did not always: joins, aggregates and full-text search were DNF until the query compiler gained `joinableSelectFrom`, `aggregateSelectFrom` and `ftsSelectFrom`. The
route-coverage grid on the dashboard is generated from the measured run, so it cannot drift from that claim.

Driving the upstream k6 replay is not automated — it wants a seeded Northwind database and, to be worth quoting, a two-machine rig. `yarn bench:orm` prints the manual steps rather than pretending. The
measured numbers currently on the dashboard come from `orm/` here: a real k6 replay against a podman Postgres, on one box, which the dashboard's provenance block says plainly.

```sh
# single-box reproduction, all three ORMs from one server
podman run -d --name zmdb-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bench \
  -p 55432:5432 docker.io/library/postgres:16-alpine
cd benchmarks/harness/orm && npm install && node load-pg-full.mjs
ORM=drizzle PORT=3000 node --experimental-strip-types server.ts &
ORM=kysely  PORT=3001 node --experimental-strip-types server.ts &
ORM=zmdb    PORT=3002 node --experimental-strip-types server.ts &
HOST=http://localhost:3000 k6 run bench.js
```

A route an ORM's builder cannot express returns **HTTP 501** here — an explicit per-route DNF, never a faked 200.

## Framework (HTTP) — the-benchmarker/web-frameworks

`@zmdb/web` participates under the upstream shared contract: port **3000**, `GET /` (empty), `GET /user/:id` (echoes the id), `POST /user` (empty). The participant directory is purely additive — a new
`javascript/zmdb/` — so there is no patch. Its `entry.ts` is a one-line import of [`framework/app.ts`](./framework/app.ts) so the contract app lives in exactly one place and the participant cannot
drift from the harness.

Every participant is contract-verified by `framework/contract-check.mjs` before any load is applied: a fast wrong answer is not a result.

```sh
yarn bench:framework
# upstream's rake knobs, same names:
CONCURRENCIES=64,256,512 ROUTES='GET:/,GET:/user/42,POST:/user' \
  bash benchmarks/harness/framework/run.sh
```

`run.sh` builds `@zmdb/web`, esbuild-compiles the app (lowering its Stage-3 decorators — Node 26 does not run standard decorators natively yet), starts it, verifies the contract, then drives `oha`
(15s per route, keep-alive disabled, latency-corrected) and extracts the upstream metric fields. `framework/peers/peers-run.sh` does the same for 17 peer frameworks across six runtimes **on the same
box**, which is the only version of this comparison worth publishing.

Upstream's own published table is carried on the dashboard too, in a separate section, because it was measured on different hardware.

See [`framework/SPEC.md`](./framework/SPEC.md) for the full contract, methodology and reporting policy.

## Where the numbers end up

`bench.mjs` normalises each suite's raw output into `../site/{validation,orm,framework}.json`, each carrying the upstream commit that was grafted, the machine, the runtime, the load profile and the
measurement's own timestamp. `docs-site/benchmarks.mjs` renders those files and nothing else, so a figure on the docs site can always be traced to a file you can download from the same page.

Those JSON files are **committed**. That is the whole handover between measuring and publishing.

## Nothing here runs in CI

Measuring happens on a machine someone can name. A GitHub runner is a shared VM of unstated hardware with neighbours competing for the same cores, so a number from one is not worth committing, and a
throughput threshold against one fails on runner variance rather than on a regression — which is how a guardrail teaches people to ignore it.

So the split is:

| Locally, by a human                                   | In CI                                          |
| ----------------------------------------------------- | ---------------------------------------------- |
| `yarn bench` — graft, measure, normalise              | `yarn verify:bench` — check what was committed |
| `yarn guardrail --live` — measure now vs the baseline | Pages renders `../site/*.json` as-is           |
| commit `../site/*.json` + `../RESULTS.md`             | —                                              |

`yarn verify:bench` (`.github/scripts/verify-bench-results.mjs`) measures nothing. It checks that each committed JSON still names its machine, methodology and timestamp, that it has rows including a
zmdb one, that `../RESULTS.md` covers every in-scope case, and that each file's `upstreamCommit` still matches the submodule pinned in the tree. That last check is the one with teeth: bumping an
upstream submodule invalidates every number measured against the old one, and CI will say so instead of publishing stale figures under a new commit.

`yarn guardrail` needs `--current <file>` or an explicit `--live`. It used to measure when given neither, which is exactly the accident this arrangement is meant to prevent.
