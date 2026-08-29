# Zero-Maintenance Data Layer — Architecture Specification

> **Project Status**: Architectural Blueprint  
> **Target Runtime**: Node.js 26+ (ESM-only, no CommonJS)  
> **Target TypeScript**: 7.0+ (stage 3 proposals permitted)  
> **Performance Target**: Zero runtime overhead, native V8 execution speed

> 📖 For end-to-end, real-world usage (model definition, CRUD, transactions,
> relations, validation, Ser/De, JSON/OpenAPI), see the **[Cookbook](./COOKBOOK.md)**.

---

## 1. Design Philosophy

This framework exists to solve one problem: **schema drift** in TypeScript backends. When a single database column changes, developers today must manually update:

1. SQL migrations
2. ORM entities
3. Validation schemas (Zod/Valibot)
4. Create DTOs
5. Update DTOs
6. Response types
7. Repository methods

Our core principle: **modify once, propagate everywhere**.

### 1.1 The Three Pillars

| Pillar | Directive | Implementation |
|--------|-----------|----------------|
| **Zero-Overhead Runtime** | No proxies, no runtime reflection, no dynamic parsing | AOT transformer inlines validation; query builder compiles to raw SQL strings |
| **Single Source of Truth** | One definition drives all derived types | Schema DSL generates Entity, CreateDTO, UpdateDTO, ResponseDTO at compile-time |
| **Encapsulated Repository** | <10 lines to get full CRUD with auto-validation | BaseRepository generic with AOT-validated interceptors |

### 1.2 Non-Negotiable Constraints

- **No CommonJS**. ESM-only. Node 26+ required.
- **No runtime validation libraries** (Zod, Valibot, Yup). Use AOT-transformed inline checks.
- **No ORM-style identity maps or stateful entities**. Raw SQL, raw results.
- **No dynamic type reflection at runtime**. All type derivation happens at compile-time.
- **Stage 3 proposals permitted**: `using` declarations, `await` for import assertions, decorator metadata.

---

## 2. Package Architecture

We split into **four focused packages** to keep each concern isolated, testable, and independently versionable.

```
zmdb/  (repository root)
├── packages/
│   ├── schema-core          # The DSL, type derivation engine, and schema metadata
│   ├── query-compiler       # Kysely fork with custom SQL compilation
│   ├── aot-validator        # TypeScript transformer + validation rule definitions
│   └── repository           # BaseRepository, auto-validation interceptors
├── package.json             # Workspace root
└── tsconfig.base.json       # Shared TS config
```

---

### 2.1 Package: `@zmdb/schema-core`

**Purpose**: Single Source of Truth. Defines the schema DSL and derives all types.

**Public API**:

```typescript
// Schema definition
import { defineSchema, serial, integer, text, numeric, jsonEnum, validate, tags, references, notNull } from '@zmdb/schema-core';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+$')),
  role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now'),
});

// Derived types (auto-generated)
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';
type User = Entity<typeof UserSchema>;
type CreateUser = CreateDTO<typeof UserSchema>;
type UpdateUser = UpdateDTO<typeof UserSchema>;
```

**Internal Structure**:

```
schema-core/src/
├── dsl/
│   ├── columns.ts      # Column builders: serial(), integer(), text(), etc.
│   ├── modifiers.ts    # notNull(), defaultTo(), primaryKey(), references()
│   ├── validation.ts   # tags.Minimum, tags.MaxLength, tags.Pattern, etc.
│   └── index.ts
├── derivation/
│   ├── entity.ts       # Entity<T> type
│   ├── create-dto.ts   # CreateDTO<T> type (strips auto-increment)
│   ├── update-dto.ts   # UpdateDTO<T> type (all partial)
│   └── index.ts
├── metadata/
│   ├── schema.ts       # CoreSchema<T> interface
│   └── registry.ts     # Compile-time schema registry
├── index.ts            # Public exports
└── package.json
```

**Dependencies**: None (pure type definitions + runtime DSL objects).

---

### 2.2 Package: `@zmdb/query-compiler`

**Purpose**: Zero-overhead query building. Fork of Kysely's compiler, stripped of runtime type resolution, optimized for raw SQL output.

**Public API**:

```typescript
import { createQueryCompiler } from '@zmdb/query-compiler';

const qb = createQueryCompiler();

// Compiles to raw SQL string — no runtime type resolution
const sql = qb
  .selectFrom('users')
  .where('email', '=', 'user@example.com')
  .where('role', '=', 'admin')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .compile();

// sql.text === "SELECT * FROM users WHERE email = $1 AND role = $2 ORDER BY createdAt DESC LIMIT 10"
// sql.parameters === ['user@example.com', 'admin']
```

**Internal Structure**:

```
query-compiler/src/
├── compiler/
│   ├── select.ts       # SELECT compilation
│   ├── insert.ts       # INSERT compilation
│   ├── update.ts       # UPDATE compilation
│   ├── delete.ts       # DELETE compilation
│   └── index.ts
├── dialect/
│   ├── postgres.ts     # PostgreSQL dialect
│   ├── mysql.ts        # MySQL dialect
│   ├── sqlite.ts       # SQLite dialect
│   └── index.ts
├── types/
│   ├── sql-result.ts   # CompiledQuery<T> interface
│   └── parameter.ts    # Parameterized query types
├── index.ts
└── package.json
```

**Dependencies**: None (pure compiler, no DB driver coupling).

**Why not use Kysely directly?**
- Kysely maintains runtime type resolution for ergonomics. We strip it for raw speed.
- We add custom AOT validation hooks directly into the query compilation pipeline.
- We emit parameterizable SQL strings, not Kysely's Result types.

---

### 2.3 Package: `@zmdb/aot-validator`

**Purpose**: Compile-time validation inlining. TypeScript transformer that replaces validation function calls with inline JavaScript checks.

**Public API** (for schema-core to consume):

```typescript
import { defineValidation, tags } from '@zmdb/aot-validator';

// This call gets AOT-transformed:
// validate(tags.Minimum(0), input.totalPrice)

// Becomes (at compile time):
// (typeof input.totalPrice === 'number' && input.totalPrice >= 0)
```

**Internal Structure**:

```
aot-validator/src/
├── transformer/
│   ├── plugin.ts               # TypeScript plugin entry
│   ├── visitors/
│   │   ├── call-expression.ts  # Intercept validateX() calls
│   │   └── binary-expression.ts # Inline boolean checks
│   └── index.ts
├── rules/
│   ├── minimum.ts              # tags.Minimum → >= check
│   ├── maximum.ts              # tags.Maximum → <= check
│   ├── min-length.ts           # tags.MinLength → .length >= check
│   ├── max-length.ts           # tags.MaxLength → .length <= check
│   ├── pattern.ts              # tags.Pattern → RegExp.test()
│   ├── enum.ts                 # tags.Enum → includes() check
│   └── index.ts
├── js-emitter/
│   ├── emitter.ts              # AST → JavaScript string
│   └── index.ts
├── types/
│   └── validation-rule.ts      # ValidationRule union type
├── index.ts
└── package.json
```

**Build-Time Behavior**:
1. User writes `validate(tags.Minimum(0), input.price)`
2. TypeScript compiles with our transformer
3. Transformer replaces the call with inline `input.price >= 0`
4. **Zero runtime cost**: the `validate()` function never executes in production

**Dependencies**: `typescript` (dev), `@types/typescript` (dev).

---

### 2.4 Package: `@zmdb/repository`

**Purpose**: The encapsulated repository pattern. Auto-validating CRUD with <10 lines of declarative setup.

**Public API**:

```typescript
import { BaseRepository } from '@zmdb/repository';
import { UserSchema } from './user.schema';

export class UserRepository extends BaseRepository<typeof UserSchema> {
  // Inherits: findById, findOne, create, update, delete, findAll
  
  // Add domain queries (no validation boilerplate needed)
  async findAdmins() {
    return this.query
      .selectFrom(this.tableName)
      .where('role', '=', 'admin')
      .execute();
  }
}

// Usage:
const repo = new UserRepository(dbPool);
await repo.create({ email: 'admin@example.com', role: 'admin' });
// → Validates against CreateDTO<UserSchema> automatically
// → Inserts into 'users' table
// → Returns Entity<UserSchema>
```

**Internal Structure**:

```
repository/src/
├── base/
│   ├── base-repository.ts      # Generic CRUD + validation interceptors
│   └── index.ts
├── interceptors/
│   ├── create-interceptor.ts   # validateCreate() → AOT check
│   ├── update-interceptor.ts   # validateUpdate() → AOT check
│   └── index.ts
├── hooks/
│   ├── pre-insert.ts           # Pre-insert hooks
│   ├── post-select.ts          # Post-select hooks
│   └── index.ts
├── index.ts
└── package.json
```

**Dependencies**: `@zmdb/schema-core`, `@zmdb/query-compiler`, `@zmdb/aot-validator`.

---

## 3. Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEVELOPER WRITES                                     │
│                                                                             │
│   user.schema.ts                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ defineSchema('users', {                                            │   │
│   │   id: serial().primaryKey(),                                       │   │
│   │   email: text().notNull().validate(tags.Pattern(...)),             │   │
│   │   role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),   │   │
│   │   createdAt: timestamp().notNull().defaultTo('now')                │   │
│   │ })                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SCHEMA-CORE (Compile-Time)                             │
│                                                                             │
│   Type Derivation:                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Entity<UserSchema> = { id: number, email: string, role: string,    │   │
│   │                       createdAt: Date }                             │   │
│   │                                                                       │   │
│   │ CreateDTO<UserSchema> = { email: string, role?: string }           │   │
│   │   // id, createdAt stripped (auto-increment)                       │   │
│   │                                                                       │   │
│   │ UpdateDTO<UserSchema> = Partial<CreateDTO<UserSchema>>             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AOT-VALIDATOR (Compile-Time)                           │
│                                                                             │
│   Transformer inlines validation:                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ validate(tags.Pattern(...), input.email)                           │   │
│   │        ↓ (transformed)                                             │   │
│   │ /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(input.email)│   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      QUERY-COMPILER (Build-Time)                            │
│                                                                             │
│   SQL Compilation:                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ query.selectFrom('users').where(...).compile()                     │   │
│   │        ↓                                                            │   │
│   │ { text: "SELECT * FROM users WHERE email = $1", params: [...] }    │   │
│   └────────────────────────���────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      REPOSITORY (Runtime)                                   │
│                                                                             │
│   Execution:                                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ class UserRepository extends BaseRepository                        │   │
│   │   async create(payload) {                                          │   │
│   │     const validated = this.validateCreate(payload); // AOT check  │   │
│   │     const sql = queryCompiler.insertInto(...).values(validated)    │   │
│   │     return db.execute(sql.text, sql.parameters);                   │   │
│   │   }                                                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DATABASE (Runtime)                                     │
│                                                                             │
│   Raw SQL executes against PostgreSQL/MySQL/SQLite                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Language Decision

### Recommendation: TypeScript for All Packages

Despite the PRD's openness to non-TypeScript implementation, we recommend **TypeScript for all packages** because:

1. **TypeScript 7's metadata reflection** (experimental) can replace runtime schema inspection
2. **TypeScript's transformer API** is first-class — writing a custom transformer in another language adds friction
3. **The ecosystem is TypeScript** — contributors will expect TS
4. **Zero overhead argument is weak** — the runtime cost of TypeScript compilation is paid once at install time, not per-request

We **do not** use `.ts` files for the `aot-validator` transformer itself (it's a plugin). But the schema-core, query-compiler, and repository packages are pure TypeScript.

---

## 5. Performance Targets

| Metric | Target | How We Achieve |
|--------|--------|----------------|
| **Validation throughput** | 10x-100x faster than Zod | AOT inlined checks, no parsing |
| **Query compilation** | <1μs overhead | Pre-compiled SQL strings, no runtime type resolution |
| **Memory allocation** | 0 heap allocations for simple queries | Direct SQL string concatenation, no object wrappers |
| **Bundle size** | <50KB total (tree-shaken) | No runtime dependencies |

---

## 6. Opinionated Design Directives

### 6.1 No "Smart" Entities
```typescript
// ❌ FORBIDDEN: Mikro-ORM style — mutate a live proxy, flush later
const user = em.findOne(User, 1);
user.email = 'new@example.com';
await em.flush(); // change tracked via proxy; implicit persistence

// ✅ REQUIRED: fetched rows are inert plain objects; writes are explicit
const user = await users.findById(1);
// `user` is a plain object (prototype === Object.prototype).
// Mutating it does NOTHING to the database:
user.email = 'new@example.com';   // local edit only — not persisted

// To persist, call an explicit, validated repository method:
await users.update(1, { email: 'new@example.com' });
// → validates the partial against UpdateDTO<S>, compiles UPDATE ... RETURNING *
```

Persistence happens **only** when you call `create` / `update` / `delete`
by name. There is no hidden change tracking and no `flush()`. For grouped,
all-or-nothing writes, use an explicit transaction (see the Cookbook).


### 6.2 No Runtime Schema Inspection
```typescript
// ❌ FORBIDDEN: Reflect metadata
const columns = Reflect.getMetadata('schema:columns', UserSchema);

// ✅ REQUIRED: Compile-time only
type UserColumns = UserSchema['columns']; // TypeScript type, erased at runtime
```

### 6.3 No Dynamic Validation at Runtime
```typescript
// ❌ FORBIDDEN: Zod/Valibot parsing
const parsed = UserCreateSchema.parse(input);

// ✅ REQUIRED: AOT inlined
const validated = input.email.match(/^...$/) && typeof input.role === 'string';
// The validate() call is transformed away at compile time
```

### 6.4 Explicit SQL, Always
```typescript
// ❌ FORBIDDEN: Implicit query building
const users = await db.users.where({ role: 'admin' });

// ✅ REQUIRED: Explicit compiler
const sql = qb.selectFrom('users').where('role', '=', 'admin').compile();
const users = await db.execute(sql.text, sql.parameters);
```

### 6.5 No CommonJS, No Dual Publishing
```typescript
// package.json
{
  "type": "module",  // ESM-only
  "exports": {
    ".": "./dist/index.js"  // No ".cjs" fallback
  }
}
```

---

## 7. Versioning & Release Strategy

- **Independent versioning** per package (e.g., `@zmdb/query-compiler@2.1.0` while `@zmdb/schema-core@1.0.0`)
- **Strict dependency ranges** (no `*` or `^`, exact versions preferred)
- **Release tags**: `beta` for experimental features, `latest` for stable

---

## 8. Open Questions (For Team Discussion)

| Question | Options | Recommendation |
|----------|---------|----------------|
| **Custom SQL functions?** | Allow UDF registration or inline only | Allow registration for Postgres functions |
| **Migrations?** | Built-in or external (e.g., Drizzle) | External — keep scope narrow |
| **Soft deletes?** | Built-in flag or manual | Manual — more explicit |
| **Multi-tenancy?** | Schema prefixing or row-level | Row-level with tenant_id column |
| **Testing strategy?** | Integration tests per package | Unit tests for types/compiler, integration for repository |

---

## 9. Files to Create

```
zmdb/  (repository root)
├── package.json
├── tsconfig.base.json
├── vitest.config.ts
├── .nvmrc                       # 26
├── packages/
│   ├── schema-core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── dsl/
│   │       │   ├── columns.ts
│   │       │   ├── modifiers.ts
│   │       │   ├── validation.ts
│   │       │   └── index.ts
│   │       ├── derivation/
│   │       │   ├── entity.ts
│   │       │   ├── create-dto.ts
│   │       │   ├── update-dto.ts
│   │       │   └── index.ts
│   │       ├── metadata/
│   │       │   ├── schema.ts
│   │       │   └── registry.ts
│   │       └── index.ts
│   ├── query-compiler/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── compiler/
│   │       ├── dialect/
│   │       ├── types/
│   │       └── index.ts
│   ├── aot-validator/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── transformer/
│   │       ├── rules/
│   │       ├── js-emitter/
│   │       ├── types/
│   │       └── index.ts
│   └── repository/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── base/
│           ├── interceptors/
│           ├── hooks/
│           └── index.ts
└── ARCHITECTURE.md
```

---

## 10. Next Steps

1. **Initialize workspace** with turbo.json and base tsconfig
2. **Implement schema-core DSL** — column types, modifiers, type derivation
3. **Implement query-compiler** — minimal Kysely fork (SELECT/INSERT/UPDATE/DELETE)
4. **Implement aot-validator** — transformer + validation rules
5. **Implement repository** — BaseRepository with validation interceptors
6. **Write integration tests** — end-to-end schema → query → DB

---

*Architecture approved: 2026-08-29*
*Maintainer: [Your Name Here]*