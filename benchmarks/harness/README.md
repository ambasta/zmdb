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

## ORM — the actual drizzle-benchmarks query set (p1–p13), REAL PostgreSQL

```sh
# 1. Real Postgres (podman or docker)
podman run -d --name zmdb-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bench \
  -p 55432:5432 docker.io/library/postgres:16-alpine

# 2. Get the upstream Northwind DB (drizzle-benchmarks/src/sqlite/northwind.db)
#    and place it next to the harness as ./northwind.db

# 3. Install + load the FULL dataset into Postgres
cd benchmarks/harness/orm && npm install
node load-pg-full.mjs            # all tables: customers/employees/suppliers/products/orders/order_details

# 4. Run the exact upstream query set p1–p13 for each ORM builder
node --experimental-strip-types orm-full.bench.ts
```

`orm-full.bench.ts` implements every upstream prepared query (p1–p13) with each
ORM's **own builder API**. A query a builder cannot express is reported `DNF`
(the feature-gap metric). Competitors: drizzle-orm (node-postgres), kysely
(PostgresDialect). Prisma is DNF (engine not installed); the k6 distributed rig
is DNF (single-process tinybench used instead).

Connection string: `postgres://postgres:postgres@localhost:55432/bench`.
