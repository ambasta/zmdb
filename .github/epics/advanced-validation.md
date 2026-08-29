# [EPIC] Advanced Validation Semantics (AOT refinements, transforms, unions, coercion, brands)

## Goal
Match zod's expressive validation surface and typia's rich type support — but **AOT-compiled** by `@zmdb/aot-validator` into inline JS, never runtime-parsed. Extends the base validator (issue #3) beyond primitive tag checks.

## Parity Reference
- **zod**: `.refine()`/`superRefine`, `.transform()`, `union`/`discriminatedUnion`, `z.coerce`, `.brand()`, `.catch()`, custom error messages, strict/passthrough object modes.
- **typia**: complex union narrowing, recursive types, nested object validation, detailed error paths.

## Adopted (aligned with our architecture)
- **Refinements**: custom predicate checks inlined at compile time (`refine(expr)`).
- **Transforms**: post-validation value transforms (must be pure; compiled inline).
- **Unions & discriminated unions**: compile-time exhaustive branch checks.
- **Coercion**: opt-in coercion emitted as inline conversions.
- **Branded types**: nominal typing via TS branding (compile-time only).
- **Custom error messages** with structured error paths.
- **Object strictness modes**: strict / strip / passthrough at compile time.

## Explicitly Rejected (anti-patterns for us)
- ❌ Async refinements at the validation boundary (validation must be synchronous, inline, allocation-free).
- ❌ `z.lazy` runtime schema graphs (recursion handled by compile-time type recursion instead).
- ❌ Any runtime parser object retained on the heap.

## Definition of Done
Fully resolved when all sub-issues are closed. Sub-issues collectively deliver:
1. Frozen spec for the advanced validation grammar + emitted-JS contract.
2. Refinement compilation.
3. Transform compilation.
4. Union / discriminated-union compilation.
5. Coercion + branded types.
6. Structured error reporting + object strictness modes.

## Constraints
- All checks compile to allocation-free inline JS.
- Synchronous only.
- ESM-only, Node 26+, TypeScript 7.0+.

Sub-issues linked below as a task list.