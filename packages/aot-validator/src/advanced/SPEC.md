# Advanced Validation Semantics — Frozen Spec (Issue #45)

> Status: **FROZEN** for TDD. Implementation (#46–#50) must satisfy this spec. Part of `@zmdb/aot-validator`. Targets: Node 26+, ESM, TS 7, synchronous & inline.

## 1. Refinements

```ts
refine(predicateSource: string, message: string): Rule
```

Emitted inline: the predicate expression is inlined verbatim against the value; on failure a structured error carrying `message` is produced. Predicates MUST be pure and synchronous.

## 2. Transforms

```ts
transform(fnSource: string): Rule   // pure, runs AFTER validation passes
```

Emitted inline as a direct conversion; output type is reflected at compile time.

## 3. Unions / discriminated unions

- `union(...rules)`: emitted as ordered short-circuit branch checks.
- `discriminated(key, { tag: rule })`: emitted as a `switch` on `value[key]`.

## 4. Coercion, branded types, object strictness

- `coerce.number(expr)` → inline `Number(expr)` with NaN guard.
- Branded types: compile-time only nominal typing; no runtime footprint.
- Object modes: `strict` (reject excess keys), `strip` (delete excess), `passthrough`.

## 5. Structured error object (shared)

```ts
interface ValidationIssue {
  readonly path: string; // exact, e.g. "input.orders[2].totalPrice"
  readonly expected: string; // e.g. "number (>= 0)"
  readonly value: unknown; // offending value
  readonly message: string;
}
```

Nested failures MUST report exact paths including array indices and nested keys.

## 6. Non-goals (rejected)

- Async refinements. `z.lazy`-style runtime schema graphs. Heap-retained parsers.
