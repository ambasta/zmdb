# Standalone performance investigations

Read the [8 September 2026 results and RCA](./2026-09-08.md) before interpreting the numbers. These runners are outside the test suite and CI. They exercise the public product source, not published
tarballs.

Use the recorded Node/Bun/Deno versions and install repository dependencies with `yarn install --immutable`. Keep output outside the checkout, and finish setup before timing. Run one measurement
process at a time. CPU numbers below reproduce this laptop's placement; choose separate physical cores on another machine.

Peer versions are pinned in setup. Exact transitive npm locks from the recorded run are in its external evidence directory. To replay those exact dependencies, copy the relevant lock and manifest to
the new output's `tooling` or `deps` directory and run `npm ci` there. These isolated peer installations do not modify the repository's Yarn dependencies.

## HTTP

```bash
http_out="$PWD/../zmdb-bench-results/http"
node benchmarks/rca/http/prepare.mjs "$http_out"
yarn tsc -p "$http_out/tsconfig.workload.json"
node benchmarks/rca/http/run.mjs --out="$http_out" --mode=smoke
node benchmarks/rca/http/run.mjs --out="$http_out" \
  --mode=measure --passes=3 --seconds=8 --warmup=2 \
  --connections=64 --workloads=parameter,validation \
  --server-cpu=4 --client-cpu=10,12,14
```

Bun resolves from `PATH`. Deno and oha default to the existing cache at `benchmarks/harness/framework/.bin/`; use `--bun=`, `--deno=` and `--oha=` to select other binary paths. The measured oha
version is 1.16.0.

For a separate CPU profile, select one candidate and workload:

```bash
node benchmarks/rca/http/run.mjs --out="$http_out" --mode=profile \
  --candidates=zmdb-deno --workloads=validation \
  --passes=1 --seconds=10 --warmup=2
```

Profile mode supports Node and Deno. It uses their native V8 profiler, not timings from an instrumented substitute server. Profiles include warmup and response checks; use the clean measurement files
for rankings.

## PostgreSQL repository

Use a disposable PostgreSQL 18.6 database with `pg_stat_statements` preloaded and the extension created. Seeding replaces the three `rca_orm_*` tables. The recorded server ran with normal durability,
128 MiB shared buffers, pool size 12, CPUs 6–11 and a 2 GiB container memory limit. Its digest and settings are in the results.

```bash
orm_out="$PWD/../zmdb-bench-results/orm"
mkdir -p "$orm_out/deps"
npm install --prefix "$orm_out/deps" --save-exact --ignore-scripts \
  --no-audit --no-fund pg@8.23.0 drizzle-orm@0.45.2 kysely@0.29.5
ln -s "$orm_out/deps/node_modules" benchmarks/rca/orm/node_modules
export PGURL='postgres://zmdb_bench:zmdb_bench@127.0.0.1:55438/zmdb_bench'

node --import ./scripts/ts-specifier-hook.mjs benchmarks/rca/orm/prepare.mjs \
  --out "$orm_out/generated-schema.json"

orm_command=(taskset -c 4 node --import ./scripts/ts-specifier-hook.mjs
  benchmarks/rca/orm/run.mjs --schema "$orm_out/generated-schema.json")
"${orm_command[@]}" --mode seed --out "$orm_out/seed.json"
"${orm_command[@]}" --mode smoke --out "$orm_out/smoke.json"
"${orm_command[@]}" --mode run --out "$orm_out/clean.json"
```

Defaults reproduce all 72 clean cells. The seed and indexes are shared by every candidate. Lookup returns one row; nested population returns the same complete 25-user graph, including posts and
comments. The native Drizzle relational lane uses its own one-query strategy. Other graph lanes use three batched reads.

Run diagnostics separately:

```bash
"${orm_command[@]}" --mode run --trace \
  --variants pg,zmdb-builder,repository,deferred,drizzle-relational \
  --workloads nested --rounds 1 --out "$orm_out/trace.json"
"${orm_command[@]}" --mode profile \
  --variants zmdb-builder,repository,drizzle-relational \
  --workloads nested --concurrency 48 --rounds 1 --duration 10000 \
  --profile "$orm_out/cpu" --out "$orm_out/profile.json"
"${orm_command[@]}" --mode explain \
  --variants repository,drizzle-relational --workloads nested \
  --out "$orm_out/plans.json"
```

Trace instrumentation affects throughput and latency. Profile mode omits the latency arrays; its p99 is intentionally absent. Remove the task-owned `benchmarks/rca/orm/node_modules` symlink when
finished.

## Generated validation and serialization

```bash
validation_out="$PWD/../zmdb-bench-results/validation"
node benchmarks/rca/validation/prepare.mjs "$validation_out"
node benchmarks/rca/validation/run.mjs "$validation_out"
taskset -c 4 node benchmarks/rca/validation/run.mjs "$validation_out" --measure \
  > "$validation_out/measurement.json"
taskset -c 4 node benchmarks/rca/validation/run.mjs "$validation_out" --measure --ablations \
  > "$validation_out/ablation.json"
```

Setup uses the actual zmdb and Typia compilers. Typia's native plugin may perform a cold toolchain build; let that finish before any measurement. The shared model drives generated validators and peer
schemas. Smoke mode checks output semantics without reporting speed. The ablations remain in memory and do not edit product files. Results are batch nanoseconds/op, not single-call p99 estimates.

## Historical Northwind tail diagnostic

`orm-http/run.mjs` reuses `benchmarks/harness/orm/server.ts` and the upstream 13-route replay. Install that harness's dependencies, then seed the disposable database using
`PGURL=... node benchmarks/harness/orm/load-pg-full.mjs`. This seed replaces the Northwind tables. Set `BENCH_OUT` to an external directory, `PGURL` to that database and `K6` to the k6 binary
(recorded version 2.2.0).

```bash
BENCH_OUT="$PWD/../zmdb-bench-results/orm-http" \
  K6=/path/to/k6 PGURL="$PGURL" POOL_MAX=12 VUS=400 DURATION=15s LABEL=baseline \
  node benchmarks/rca/orm-http/run.mjs
```

For the indexed half of the A/B experiment, create these indexes on that same disposable database:

```sql
CREATE INDEX rca_customers_search_gin
  ON customers USING gin(to_tsvector('english', company_name));
CREATE INDEX rca_products_search_gin
  ON products USING gin(to_tsvector('english', name));
ANALYZE customers;
ANALYZE products;
```

Repeat in A/B/B/A order, dropping these two indexes for the final A. Use distinct `LABEL` values. `INSTRUMENT=1 PROFILE=1` records a separate diagnostic pass. This experiment compares zmdb with
itself; it is not a competitor ranking. A fair cross-framework comparison must share these indexes and match selected fields and response shapes first.
