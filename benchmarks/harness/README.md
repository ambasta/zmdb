# Benchmark reproduction

zmdb run as a participant in the **exact upstream benchmark suites**, against real
installed competitor libraries. Authoritative results: [`../RESULTS.md`](../RESULTS.md).
Rendered dashboard: `site/benchmarks/index.html` after `yarn build:docs`.

## The short version

```sh
git submodule update --init --depth 1   # the three upstream suites
yarn bench                              # graft zmdb in, measure, normalise
yarn build:docs                         # render the dashboard
```

`yarn bench` takes the suites one at a time and prints, for each, either the
measurement or the precondition that is missing. It never fills a gap with a
zero — a suite that could not run is reported as not run, and the dashboard shows
that instead of a number.

| Command                                       | What it does                                              |
| --------------------------------------------- | --------------------------------------------------------- |
| `yarn bench`                                  | all three suites, then normalise                          |
| `yarn bench:validation`                       | moltar suite only, installing its dependencies            |
| `yarn bench:orm`                              | drizzle-benchmarks only (needs `k6` + `DATABASE_URL`)     |
| `yarn bench:framework`                        | web-frameworks contract + `oha` load, plus every peer     |
| `yarn bench:normalize`                        | re-derive the dashboard JSON from results already on disk |
| `yarn bench:graft` / `yarn bench:graft:check` | apply / verify the graft without measuring                |

## How zmdb gets into someone else's suite

The three suites are git submodules under [`../upstream/`](../upstream). Nothing in
them is edited by hand. `../scripts/graft.mjs` combines two kinds of change, kept
separate on purpose:

- **[`../participants/`](../participants)** — whole files that are ours (a case, a
  server, a framework directory). Copied into the submodule. No conflict is
  possible, so bumping a submodule can never break them.
- **[`../patches/`](../patches)** — the minimal edits to upstream's own files:
  registering the participant in a list, adding a compile script. Applied with
  `git apply --3way`, which survives unrelated drift and fails loudly on real
  drift rather than half-applying. If a patch stops applying, `graft.mjs` says so
  and prints the command that regenerates it.

None of this is meant to be upstreamed: the participants import this repository's
sources by relative path, which only resolves from inside the submodule checkout.
`graft.mjs --clean` returns every submodule to pristine.

## Validation — moltar/typescript-runtime-type-benchmarks

Two participants, deliberately not one:

- **`zmdb`** — the runtime validator walking a `TypeDescriptor`. No transformer.
- **`zmdb-aot`** — the same public API with `@zmdb/aot-validator`'s transformer
  applied. `cases/zmdb-aot/src/generate.ts` runs the **real** `transformTypeChecks`
  over `is<T>()` source at compile time and refuses to emit anything if the
  transform left the call in place, so the benchmarked code is transformer output
  and not a hand-tuned lookalike.

Reporting them separately is the point: collapsing them into one row would let the
AOT number stand in for the runtime path that most callers get by default.

```sh
yarn bench:validation                              # whole field
node benchmarks/scripts/bench.mjs validation --libs=zmdb,zmdb-aot,typia,zod,valibot
```

Two things about the install: npm 12 refuses `remote`-type dependencies, and
upstream pins `@paseri/paseri` to a JSR tarball URL, so the install needs
`--allow-remote=all` (`bench.mjs` passes it). Corepack also refuses to run npm
anywhere under a repository whose `packageManager` says yarn; the submodules are
not part of this workspace, so `bench.mjs` sets `COREPACK_ENABLE_STRICT=0` for
them.

The upstream runner catches a case that fails to build and moves on, leaving no
row in `docs/results/node-<major>.json`. `bench.mjs` records the requested set
minus the measured set as `notRun`, and the dashboard lists those libraries by
name — otherwise a build failure elsewhere would read as an absence of
competition.

## ORM — drizzle-team/drizzle-benchmarks

The upstream benchmark runs **one HTTP server per ORM** and drives them with
**k6** replaying `data/requests.json`. `../participants/orm/src/zmdb-server-node.ts`
mirrors `src/drizzle-server-node.ts` route for route: same Hono app, same
cpu-usage endpoint, same `cluster.fork()` across every core, same pool geometry
(`min: 10, max: 10`). What differs is only how each route's SQL is produced.
zmdb names every statement so Postgres caches the plan, because the drizzle
participant calls `.prepare()` on every query and without that the comparison
would measure planning rather than either library.

zmdb serves **all 13 routes**. It did not always: joins, aggregates and full-text
search were DNF until the query compiler gained `joinableSelectFrom`,
`aggregateSelectFrom` and `ftsSelectFrom`. The route-coverage grid on the
dashboard is generated from the measured run, so it cannot drift from that claim.

Driving the upstream k6 replay is not automated — it wants a seeded Northwind
database and, to be worth quoting, a two-machine rig. `yarn bench:orm` prints the
manual steps rather than pretending. The measured numbers currently on the
dashboard come from `orm/` here: a real k6 replay against a podman Postgres, on
one box, which the dashboard's provenance block says plainly.

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

A route an ORM's builder cannot express returns **HTTP 501** here — an honest
per-route DNF, never a faked 200.

## Framework (HTTP) — the-benchmarker/web-frameworks

`@zmdb/web` participates under the upstream shared contract: port **3000**,
`GET /` (empty), `GET /user/:id` (echoes the id), `POST /user` (empty). The
participant directory is purely additive — a new `javascript/zmdb/` — so there is
no patch. Its `entry.ts` is a one-line import of
[`framework/app.ts`](./framework/app.ts) so the contract app lives in exactly one
place and the participant cannot drift from the harness.

Every participant is contract-verified by `framework/contract-check.mjs` before
any load is applied: a fast wrong answer is not a result.

```sh
yarn bench:framework
# upstream's rake knobs, same names:
CONCURRENCIES=64,256,512 ROUTES='GET:/,GET:/user/42,POST:/user' \
  bash benchmarks/harness/framework/run.sh
```

`run.sh` builds `@zmdb/web`, esbuild-compiles the app (lowering its Stage-3
decorators — Node 26 does not run standard decorators natively yet), starts it,
verifies the contract, then drives `oha` (15s per route, keep-alive disabled,
latency-corrected) and extracts the upstream metric fields.
`framework/peers/peers-run.sh` does the same for 17 peer frameworks across six
runtimes **on the same box**, which is the only version of this comparison worth
publishing. Upstream's own published table is carried on the dashboard too, in a
separate section, because it was measured on different hardware.

See [`framework/SPEC.md`](./framework/SPEC.md) for the full contract,
methodology and honesty policy.

## Where the numbers end up

`bench.mjs` normalises each suite's raw output into
`../site/{validation,orm,framework}.json`, each carrying the upstream commit that
was grafted, the machine, the runtime, the load profile and the measurement's own
timestamp. `docs-site/benchmarks.mjs` renders those files and nothing else, so a
figure on the docs site can always be traced to a file you can download from the
same page.

Those JSON files are **committed**. That is the whole handover between measuring
and publishing.

## Nothing here runs in CI

Measuring happens on a machine someone can name. A GitHub runner is a shared VM
of unstated hardware with neighbours competing for the same cores, so a number
from one is not worth committing, and a throughput threshold against one fails on
runner variance rather than on a regression — which is how a guardrail teaches
people to ignore it.

So the split is:

| Locally, by a human                                   | In CI                                          |
| ----------------------------------------------------- | ---------------------------------------------- |
| `yarn bench` — graft, measure, normalise              | `yarn verify:bench` — check what was committed |
| `yarn guardrail --live` — measure now vs the baseline | Pages renders `../site/*.json` as-is           |
| commit `../site/*.json` + `../RESULTS.md`             | —                                              |

`yarn verify:bench` (`.github/scripts/verify-bench-results.mjs`) measures nothing.
It checks that each committed JSON still names its machine, methodology and
timestamp, that it has rows including a zmdb one, that `../RESULTS.md` covers every
in-scope case, and that each file's `upstreamCommit` still matches the submodule
pinned in the tree. That last check is the one with teeth: bumping an upstream
submodule invalidates every number measured against the old one, and CI will say
so instead of publishing stale figures under a new commit.

`yarn guardrail` needs `--current <file>` or an explicit `--live`. It used to
measure when given neither, which is exactly the accident this arrangement is
meant to prevent.
