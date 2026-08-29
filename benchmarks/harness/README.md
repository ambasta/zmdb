# Benchmark reproduction harnesses

Real, comparative benchmarks of zmdb vs installed competitor libraries on the
upstream workloads. Results are written to [`../RESULTS.md`](../RESULTS.md).

> These harnesses install real third-party libraries and run under Node 26's
> `--experimental-strip-types`. They are intentionally **outside** the main
> workspace (own `package.json` + `node_modules`) so competitor deps do not
> leak into the shipped packages.

## Validation (`validation/`)

Reuses the [typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
data model and its four case kinds (parseSafe / parseStrict / assertLoose /
assertStrict). Competitors: zod, `@sinclair/typebox` (compiled), ajv, valibot.
zmdb runs via its **runtime** validator (its AOT transformer is not yet a wired
build plugin — see RESULTS.md honesty notes). Typia is DNF (needs its AOT build).

```sh
cd benchmarks/harness/validation
npm install
node --experimental-strip-types validation.bench.ts
```

## ORM (`orm/`) — requires real PostgreSQL

Reuses the [drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks)
Northwind dataset (10k customers / 50k orders / 308k order-details) and its
canonical query set. **All ORMs run against real PostgreSQL** (no SQLite).
Competitors: drizzle-orm (node-postgres), kysely (PostgresDialect), zmdb
query-compiler. Prisma is DNF (engine not installed).

```sh
# 1. Spin up Postgres (podman or docker)
podman run -d --name zmdb-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bench \
  -p 55432:5432 docker.io/library/postgres:16-alpine

# 2. Install deps
cd benchmarks/harness/orm && npm install

# 3. Load Northwind into Postgres (needs the drizzle-benchmarks northwind.db
#    checked out at ../northwind.db, or adjust the path in load-pg.ts)
node --experimental-strip-types load-pg.ts

# 4. Run the benchmark
node --experimental-strip-types orm.bench.ts
```

Connection string: `postgres://postgres:postgres@localhost:55432/bench`.
