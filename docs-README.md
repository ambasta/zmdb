# Zero-Maintenance Data Layer

> The fastest TypeScript ORM you'll never have to maintain.

```
┌─────────────────────────────────────────────────────────────┐
│  Define once. Everything derives. Zero boilerplate.        │
└─────────────────────────────────────────────────────────────┘
```

## The Problem

Every backend developer knows this pain:

```
Database column change → 4-5 files to update
├── migrations.sql
├── orm-entity.ts
├── validation-schema.ts
├── create-dto.ts
└── response-type.ts
```

This is **Schema Drift Maintenance Hell**. We're here to end it.

## The Solution

A TypeScript data layer framework that enforces **Single Source of Truth**:

1. **Define your schema once** — column types, constraints, validation rules
2. **Everything derives automatically** — Entity, CreateDTO, UpdateDTO, Response types
3. **Write <10 lines for full CRUD** — validation is automatic

```typescript
// Define once
export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern(...)),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});

// Get CRUD automatically
class UserRepository extends BaseRepository<typeof UserSchema> {
  // findById, create, update, delete — all inherited
}

// Add domain queries in seconds
async findAdmins() {
  return this.query.selectFrom('users')
    .where('role', '=', 'admin')
    .execute();
}
```

## Performance That Beats Hand-Written Code

- **AOT-validated** — validation inlines at compile-time, no runtime parsing
- **Zero proxies** — raw SQL, plain objects, no identity map overhead
- **Native V8 speed** — matches Typia's 10x-100x performance baseline

## Three Pillars

| Pillar                      | What It Means                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| **Zero-Overhead Runtime**   | No proxies, no runtime reflection, no dynamic parsing. AOT transformer inlines validation. |
| **Single Source of Truth**  | One schema definition drives Entity, CreateDTO, UpdateDTO, ResponseDTO at compile-time.    |
| **Encapsulated Repository** | <10 lines to get full CRUD with auto-validation. Just extend and go.                       |

## Architecture

Split into focused, independently versionable packages:

- `@zmdb/schema-core` — DSL + type derivation
- `@zmdb/query-compiler` — Kysely fork, raw SQL output
- `@zmdb/aot-validator` — TypeScript transformer for inlined validation
- `@zmdb/repository` — BaseRepository with auto-validation

## Requirements

- Node.js 26+
- TypeScript 7.0+ (stage 3 proposals welcome)
- ESM-only

## Quick Start

```bash
npm create zero-maintenance-data-layer@latest
```

Or add to an existing project:

```bash
npm install @zmdb/schema-core @zmdb/query-compiler @zmdb/aot-validator @zmdb/repository
```

## Why Not [Existing Tool]?

| Tool            | Limitation                                    |
| --------------- | --------------------------------------------- |
| **Zod/Valibot** | Runtime parsing, not AOT                      |
| **Kysely**      | Runtime type resolution, no schema derivation |
| **Drizzle**     | No automatic DTO generation                   |
| **Mikro-ORM**   | Identity maps, runtime overhead               |

This is the **fastest possible path** from schema definition to database operation — with zero ongoing maintenance.

---

**Define once. Derive everything. Ship faster.**

MIT License • Built for Node 26+ • ESM-only
