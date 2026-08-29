# [EPIC] Entity Relations (compile-time derived)

## Goal
Provide first-class relation modeling comparable to mikro-orm's ManyToOne / OneToMany / OneToOne / ManyToMany — **without** an identity map, proxies, or lazy runtime-loaded references. Relations are declared in the schema DSL and resolve to explicit, type-safe JOIN/populate SQL compiled ahead of time.

## Parity Reference
- **mikro-orm**: relation decorators, `populate` hints, bidirectional relations.

## Adopted (aligned with our architecture)
- Declarative relation definitions in `@zmdb/schema-core` DSL: `manyToOne()`, `oneToMany()`, `oneToOne()`, `manyToMany()`.
- Compile-time derivation of related entity types onto `Entity<T>` when explicitly populated.
- Explicit `.populate(['relationName'])` that compiles to deterministic JOINs / batched selects in `@zmdb/query-compiler`.
- Foreign-key metadata surfaced for migrations (see relations epic overlap with migrations epic).

## Explicitly Rejected (anti-patterns for us)
- ❌ Identity Map / shared object references.
- ❌ Proxy-based lazy loading (`await user.posts.load()` via getters).
- ❌ Automatic cascade persistence through change tracking (Unit of Work owns cascade, and only explicitly).

## Definition of Done
This epic is **fully resolved** when all its sub-issues are closed. Sub-issues collectively deliver:
1. Frozen spec for relation DSL + populate semantics.
2. Relation DSL builders in schema-core.
3. Compile-time relation type derivation.
4. JOIN/batched-select compilation in query-compiler.
5. `populate` integration in repository layer.

## Constraints
- Zero runtime reflection; relations resolved at compile-time.
- ESM-only, Node 26+, TypeScript 7.0+.

Sub-issues will be linked below as a task list.