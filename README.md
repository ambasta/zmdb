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
| [`@zmdb/schema-core`](./packages/schema-core) | 🚧 | DSL + type derivation (builders, modifiers, Entity/CreateDTO/UpdateDTO, relations, OpenAPI) |
| [`@zmdb/query-compiler`](./packages/query-compiler) | 🚧 | SELECT/INSERT/UPDATE/DELETE + dialects + migration diff/DDL |
| [`@zmdb/aot-validator`](./packages/aot-validator) | 🚧 | AOT inlining + is/assert/validate, unions, transforms, Ser/De |
| [`@zmdb/repository`](./packages/repository) | 🚧 | Auto-validating CRUD + hooks + transactions |

> Status legend: 🚧 in progress (most sub-issues closed) · 🔜 planned · ✅ complete.
> Nearly all tracked sub-issues are implemented and tested (incl. real
> `node:sqlite` E2E and a Kysely head-to-head). `random<T>` and the live-Postgres
> competitor harness remain open (the latter reported as DNF — see below).

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

We benchmark zmdb head-to-head against the industry-standard suites:

- **Validation** — the [typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
  case model (safe/strict parse, loose/strict assert) vs Typia / Zod / TypeBox / Ajv.
- **ORM** — the [drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks)
  e-commerce workload (real PostgreSQL, k6-driven) vs Drizzle / Prisma / Kysely.

**Honesty policy:** anti-pattern-only cases (identity map, proxy lazy-load,
active-record `save()`) are reported as `DNF (anti-pattern)` — visible, not
hidden. Any supported-in-principle case we haven't wired yet is reported as
`DNF (not implemented)`. We never silently skip an in-scope case.

Harness spec: [`benchmarks/SPEC.md`](./benchmarks/SPEC.md); results (once
generated) land in `benchmarks/RESULTS.md`.

## Requirements

- Node.js 26+
- TypeScript 7.0+

## License

MIT
