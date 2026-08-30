# Product Requirements Document (PRD)

## 1. Executive Summary & Objective

Modern TypeScript backends often suffer from **"Schema Drift" Maintenance Hell**, where a single database column addition requires manual updates across 4–5 different layers: SQL migrations, ORM entities, validation schemas (Zod/TypeBox), inbound Create DTOs, and outbound API Response types.

The objective of this product is to engineer a **Zero-Maintenance Data Layer Framework**. It must enforce a **Single Source of Truth** architecture with **Zero Dynamic Runtime Translation Overhead**. The developer modifies the core schema exactly once, and the entire stack (Database, Entities, Validation DTOs, and Repository Operations) adapts dynamically using compile-time derivation.

---

## 2. Technical Philosophy & Constraints

To ensure maximum machine efficiency and eliminate boilerplate code, the framework must strictly adhere to three core architectural pillars:

### ⚡ Pillar 1: Zero-Overhead Runtime Execution

- **No Object/Proxy Mapping:** No runtime abstraction layer (like active-record state machines or complex identity maps) may intercept database transactions.
- **Direct Compilation:** Database query builders must compile down natively into plain SQL string manipulations.
- **AOT Validation Only:** Application boundary validation must be evaluated using an **Ahead-of-Time (AOT)** compiler plugin. It must inline native JavaScript checking blocks directly into production builds, completely bypassing heavy runtime parsing engines (e.g., Zod, Valibot).

### 🔄 Pillar 2: Pure Schema Derivation (Single Source of Truth)

- **Single Change Vector:** Modifying a schema parameter can only happen in _one_ designated file.
- **Dependent Type Derivation:** Entities, inbound payload parameters, slice updates, and serialization structures must be derived automatically as strict, down-stream dependent TypeScript modifications.
- **Zero Duplicate Properties:** Writing explicit type properties for separate entities or DTOs is strictly forbidden.

### 🏛️ Pillar 3: Encapsulated Repository Pattern

- **Inherited Automation:** Creating a new domain model entity must instantly inherit basic CRUD workflows (Find, Create, Update, Delete) with less than 10 lines of declarative initialization code.
- **Automated Data Interception:** The inherited base methods must implicitly execute boundary payload validations tailored precisely to the target entity's constraints.

---

## 3. Detailed Component & Lifecycle Requirements

```
 ┌──────────────────────┐
 │ Single Source of Truth│ (Database Schema or Schema Core file)
 └──────────┬───────────┘
            │
            ▼ (Automated Compilation Loop)
 ┌────────────────────────────────────────────────────────┐
 │            DEPENDENT DERIVATION LAYER                  │
 ├──────────────────────────┬─────────────────────────────┤
 │ Entity Types (Selectable)│ Inbound Payloads (Insertable)│
 └──────────┬───────────────┴─────────────┬───────────────┘
            │                             │
            ▼                             ▼
 ┌────────────────────────────────────────────────────────┐
 │              BASE REPOSITORY ENGINE                    │
 ├────────────────────────────────────────────────────────┤
 │   • Auto-Intercepts Unknown Payloads                   │
 │   • Evaluates Inlined AOT Micro-Validators             │
 │   • Executes Native SQL Queries Directly               │
 └────────────────────────────────────────────────────────┘
```

### 3.1 Data Flow and Interface Compilation Loop

1. **Schema Initialization:** The core schema is updated (either programmatically or via localized migrations).
2. **Metadata Introspection:** A pipeline generator maps the schema elements directly to highly concise TypeScript interface blueprints.
3. **Implicit Typing:**
   - **`Entity<T>`** maps directly to the active query selection blueprint.
   - **`CreateDTO<T>`** strips database-generated values (e.g., identity keys, auto-increment fields, default date flags) automatically.
   - **`UpdateDTO<T>`** handles partial payload properties dynamically while strictly preserving structural validation formats.

### 3.2 Generic Repository Layer Requirements

- **Type-Bounded Targets:** The core `BaseRepository` must accept strict structural parameters mapping exclusively to valid fields within the unified database schema layout.
- **Bound Safe CRUD Execution:**
  - `.findById(id)` maps to an immutable return signature of `Entity<T> | undefined`.
  - `.create(payload: unknown)` enforces dynamic validation against `CreateDTO<T>` prior to database insertion.
  - `.update(id, payload: unknown)` evaluates variations against `UpdateDTO<T>`.

---

## 4. Operational & Developer Experience (DX) Workflow

```typescript
// =========================================================================
// DEV EXPERIENCE EXPECTATION: Adding a completely new domain to the stack
// =========================================================================

// Step 1: Core Schema defined exactly once (Example syntax block)
export const OrdersSchema = defineCoreSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().references('users.id'),
  totalPrice: numeric().validate(typia.tags.Minimum<0>()),
  status: jsonEnum(['pending', 'shipped', 'delivered']),
});

// Step 2: Boilerplate generation handles Entity, CreateDTO, UpdateDTO implicitly.
// Step 3: Instantiate domain Repository with zero manual CRUD writing.
export class OrderRepository extends BaseRepository<OrdersSchema> {
  // Inherits .create(), .update(), .findById() with auto-validation OOTB
  // Developers only write highly specific domain query overrides here:
  async findActiveOrdersByUser(userId: number) {
    return await this.rawEngine
      .selectFrom('orders')
      .where('userId', '=', userId)
      .where('status', '=', 'pending')
      .execute();
  }
}
```

---

## 5. Non-Functional Performance Benchmarks

- **Zero Allocation Footprint:** The data-fetching pipeline must not instantiate or retain heap-allocated metadata records for standard raw queries.
- **Maximum Throughput Target:** Boundary JSON validation loops must run at native V8 processing speed, matching or beating Typia's AOT baseline execution metrics (roughly **10x–100x faster** than traditional runtime parsing libraries).
- **Compile-Time Enforcement:** Any field alterations within the source schema must trigger strict, explicit TypeScript compilation errors at build time across all dependent components (Repositories, Controllers, Services) until the changes are fully resolved.
