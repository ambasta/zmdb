# zmdb

> A TypeScript data layer framework that eliminates schema drift maintenance hell.

```
┌─────────────────────────────────────────────────────────────┐
│  Define once. Everything derives. Zero boilerplate.        │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Status | Description |
|---------|--------|-------------|
| [`@zmdb/schema-core`](./packages/schema-core) | ✅ | DSL + type derivation (builders, modifiers, Entity/CreateDTO/UpdateDTO, relations, OpenAPI) |
| [`@zmdb/query-compiler`](./packages/query-compiler) | ✅ | SELECT/INSERT/UPDATE/DELETE + dialects + migration diff/DDL/runner |
| [`@zmdb/aot-validator`](./packages/aot-validator) | ✅ | AOT inlining + is/assert/validate/equals/random, unions, transforms, Ser/De |
| [`@zmdb/repository`](./packages/repository) | ✅ | Auto-validating CRUD + hooks + transactions + populate |

> Status legend: ✅ complete (all tracked sub-issues closed) · 🚧 in progress · 🔜 planned.
> All eleven capability epics (#1–#10, #62) **and** the benchmarking epic (#68)
> are complete — every tracked issue is closed. 175 tests green, including real
> `node:sqlite` E2E, a Kysely head-to-head, the full validation + ORM benchmark
> suites, and a CI job with a regression guardrail. The live-PostgreSQL
> competitor comparison is reported as `DNF (not implemented)` (see Benchmarks)
> rather than faked.

## Quick Start

```typescript
// Define once
export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern(...)),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});

// Get CRUD automatically — <10 lines
class UserRepository extends BaseRepository<typeof UserSchema> {
  // findById, create, update, delete — all inherited
}
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full details, and the
[COOKBOOK.md](./COOKBOOK.md) for real-world usage (model definition, CRUD,
transactions, relations, validation, Ser/De, JSON/OpenAPI).

## Benchmarks

We run zmdb as a participant in the **exact upstream benchmark suites**, against
the **real competitor libraries** — which also surfaces, honestly, how many
cases zmdb **cannot express** (reported as `DNF`, a real feature-gap metric):

- **Validation** — the [typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
  runner (exact parseSafe/parseStrict/assertLoose/assertStrict cases) vs Zod v3/v4,
  Valibot, Ajv, TypeBox, ArkType, myzod. zmdb covers all 4 cases (0/4 DNF).
- **ORM** — the [drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks)
  Northwind query set (exact p1–p13) against **real PostgreSQL 16** vs Drizzle / Kysely.
  zmdb is **DNF on 6/13** — joins, aggregations, and full-text search are outside
  its deliberately CRUD-focused query builder.

**Honesty policy:** zmdb's validation currently runs via its **runtime**
validator (the AOT transformer is not yet a wired build plugin), so those
numbers are labelled as runtime, not AOT. Typia (needs its AOT build) and Prisma
(engine not installed) are `DNF (not implemented)`, as is the k6 distributed rig
(single-process tinybench used). We never silently skip or fake an in-scope case.

Real comparative numbers **and the per-library DNF counts**:
[`benchmarks/RESULTS.md`](./benchmarks/RESULTS.md). Reproduction harnesses
(with the Postgres-via-podman setup): [`benchmarks/harness/`](./benchmarks/harness).

## Requirements

- Node.js 26+
- TypeScript 7.0+

## License

MIT
