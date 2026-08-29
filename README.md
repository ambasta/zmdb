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

We run zmdb inside the **actual upstream benchmark harnesses** against the
**real competitor libraries** — including the real drizzle-benchmarks method
(HTTP server per ORM + k6 load) against **real PostgreSQL 16**. This honestly
surfaces both throughput and, crucially, **which routes/cases zmdb cannot
express** (each listed individually, never summed into a score):

- **ORM** — [drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks)
  routes + k6 vs Drizzle / Kysely. **zmdb cannot serve 6 of 13 routes** (joins,
  aggregations, full-text search — no builder for them), which is **57.8% of the
  replayed traffic**. On the shared CRUD routes it *can* serve, zmdb is
  competitive (slightly ahead of kysely/drizzle here) — but it is **not** the
  fastest overall, since it forfeits the majority of the workload as DNF.
- **Validation** — [typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
  runner vs Zod v3/v4, Valibot, Ajv, TypeBox, ArkType, myzod. zmdb covers all 4
  cases (no DNF) but runs its **runtime** validator (the AOT transformer is not
  yet a wired build plugin), so JIT/AOT libraries are 6–24× faster on assert —
  the AOT premise is unproven here and not claimed.

**Honesty policy:** DNF routes/cases are enumerated individually, not aggregated.
Typia (needs its AOT build) and Prisma (engine not installed) are DNF. We never
silently skip or fake an in-scope case, and we do not claim a "fastest" title we
have not earned across the full workload.

Full results + per-route/per-case DNF listings:
[`benchmarks/RESULTS.md`](./benchmarks/RESULTS.md). Reproduction (HTTP servers +
k6 + Postgres-via-podman): [`benchmarks/harness/`](./benchmarks/harness).

## Requirements

- Node.js 26+
- TypeScript 7.0+

## License

MIT
