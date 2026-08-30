# Benchmark reproduction harnesses

zmdb run as a participant in the **exact upstream benchmark suites**, against
real installed competitor libraries. Authoritative results:
[`../RESULTS.md`](../RESULTS.md).

> These harnesses install real third-party libraries and run under Node 26.
> They are outside the main workspace so competitor deps do not leak into the
> shipped packages.

## Validation — the actual moltar suite

The honest way to run this is **inside a clone of the upstream repo** so zmdb is
measured by the upstream runner alongside every other library (and DNF =
un-registered cases):

```sh
git clone https://github.com/moltar/typescript-runtime-type-benchmarks
cd typescript-runtime-type-benchmarks
# remove the JSR-only paseri deps that block offline install:
#   drop @paseri/* from package.json + delete cases/paseri* + their index entries
npm install

# add zmdb as a case:
cp <zmdb>/benchmarks/harness/validation/moltar-case/zmdb.ts cases/zmdb.ts
cp <zmdb>/packages/aot-validator/src/utilities/index.ts cases/zmdb/utilities.ts   # + stub the ValidationIssue import
#   add 'zmdb' to the array in cases/index.ts

# run zmdb head-to-head (add more library names as desired):
npx ts-node index.ts run zmdb zod zod4 valibot ajv myzod arktype sinclair-typebox-just-in-time
# results land in docs/results/node-<major>.json
```

zmdb registers all four upstream case kinds (parseSafe / parseStrict /
assertLoose / assertStrict) via its **runtime** validator — its AOT transformer
is not yet a wired build plugin, so this is the runtime path (see RESULTS.md).

## ORM — the actual drizzle-benchmarks methodology (HTTP servers + k6, REAL PostgreSQL)

The upstream benchmark runs **one HTTP server per ORM** and drives them with
**k6** replaying `data/requests.json`. `server.ts` reproduces that: it serves
the exact upstream routes, choosing the ORM via the `ORM` env var, over real
PostgreSQL. Routes an ORM's builder cannot express return **HTTP 501** (an
honest per-route DNF — never a faked 200).

```sh
# 1. Real Postgres (podman or docker)
podman run -d --name zmdb-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bench \
  -p 55432:5432 docker.io/library/postgres:16-alpine

# 2. Northwind DB from drizzle-benchmarks (src/sqlite/northwind.db) → ./northwind.db
cd benchmarks/harness/orm && npm install
node load-pg-full.mjs            # all tables into Postgres

# 3. Start a server (repeat per ORM on different ports)
ORM=drizzle PORT=3000 node --experimental-strip-types server.ts &
ORM=kysely  PORT=3001 node --experimental-strip-types server.ts &
ORM=zmdb    PORT=3002 node --experimental-strip-types server.ts &

# 4. Run the real k6 script (get k6 from grafana/k6 releases) against each,
#    replaying the upstream request list. See run-k6.sh for the orchestration
#    used to produce RESULTS.md (it also builds a "fair" replay of only the
#    routes all three ORMs can serve, so zmdb's 501 DNFs don't inflate its rate).
HOST=http://localhost:3000 k6 run bench.js
```

**Honesty**: zmdb DNFs 6 of the 13 routes (joins / aggregates / full-text
search — no builder for them), which is **57.8% of the replay traffic**. The
throughput table in RESULTS.md therefore compares only the shared CRUD routes
(fair, 0 failures) and lists every DNF route individually. Prisma is DNF
(engine not installed). `orm-full.bench.ts` is a quick in-process cross-check;
`server.ts` + k6 is the authoritative path.


## Framework (HTTP) — the actual the-benchmarker/web-frameworks methodology

`@zmdb/web` (the Stage-3 decorator web framework) participates in
**[the-benchmarker/web-frameworks](https://github.com/the-benchmarker/web-frameworks)**
under its exact shared contract: an app on port **3000** serving `GET /` (empty),
`GET /user/:id` (echoes the id), and `POST /user` (empty). Routes are validated
by a shared correctness contract first, then driven with **`oha`**
(`GET /` 15s, keep-alive disabled, latency-corrected, JSON report), collecting
**req/s + total data + p50/p75/p90/p99**. Concurrency + routes are configurable
(`CONCURRENCIES`, `ROUTES`) exactly like upstream.

```sh
# needs `oha` (https://github.com/hatoo/oha) and `jq` on PATH
bash benchmarks/harness/framework/run.sh
# customize like upstream's rake knobs:
CONCURRENCIES=64,256,512 ROUTES='GET:/,GET:/user/42,POST:/user' \
  bash benchmarks/harness/framework/run.sh
```

`run.sh` builds `@zmdb/web`, esbuild-compiles the app (lowering its Stage-3
decorators — Node 26 does not run standard decorators natively yet), starts it on
:3000, verifies the shared contract (`contract-check.mjs` — the RSpec
equivalent), then runs `oha` and extracts the upstream fields. If `oha` is not
installed it still verifies the contract and skips the load run. See
[`framework/SPEC.md`](./framework/SPEC.md) for the full contract, methodology,
and honesty policy. The app is built on `@zmdb/web`'s real routing (Stage-3
`@Controller`/`@Get`/`@Post` + `getRoutes` resolved once at boot + `extractParams`).
