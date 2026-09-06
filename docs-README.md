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

1. **Declare your table once** — as a TypeScript type, tags and all
2. **Everything derives automatically** — Entity, CreateDTO, UpdateDTO, ReadDTO
3. **Write <10 lines for full CRUD** — validation is automatic

```typescript
// Declare once — the type *is* the schema, and it compiles to no JavaScript
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+$'>;
  role: ('admin' | 'user') & HasDefault;
}

// Get CRUD automatically
const userSchema = schemaOf<User>();

class UserRepository extends BaseRepository<User> {
  static readonly schema = userSchema;
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
| **Single Source of Truth**  | One type declaration drives Entity, CreateDTO, UpdateDTO, ReadDTO at compile-time.         |
| **Encapsulated Repository** | <10 lines to get full CRUD with auto-validation. Just extend and go.                       |

## Architecture

zmdb is one product released as one lockstep train through focused package firebreaks. The product catalog owns official membership, and architecture policy owns dependency direction and publish
order:

- `@zmdb/schema-core` — the tag vocabulary, the IR, and type derivation
- `@zmdb/query-compiler` — builder to `{ text, parameters }`, never a connection
- `@zmdb/aot-validator` — TypeScript transformer for inlined validation
- `@zmdb/repository` — BaseRepository with auto-validation

The complete current graph, canonical rings, optional-peer boundaries, package-admission workflow and release workflow are generated or checked in [`ARCHITECTURE.md`](./ARCHITECTURE.md),
[`docs-site/content/architecture.md`](./docs-site/content/architecture.md), and [`PUBLISHING.md`](./PUBLISHING.md).

## Requirements

- Node.js 26+
- TypeScript 7.0+ (stage 3 proposals welcome)
- ESM-only

## Quick Start

```bash
npm add zmdb@alpha
```

Or install the packages you want:

```bash
npm install @zmdb/schema-core @zmdb/query-compiler @zmdb/aot-validator @zmdb/repository
```

Then wire the build plugin once. `schemaOf<T>()` and the validators read a type argument, which does not survive to runtime, so an untransformed build throws.

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

GPL-3.0-or-later • Built for Node 26+ • ESM-only
