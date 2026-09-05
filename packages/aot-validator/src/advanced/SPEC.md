# Advanced Validation Semantics — Frozen Spec (Issue #45)

> Status: **FROZEN** for TDD. Implementation (#46–#50) must satisfy this spec. Part of `@zmdb/aot-validator`. Targets: Node 26+, ESM, TS 7, synchronous & inline.

## 1. Refinements

```ts
refine(predicate: (value: unknown) => boolean, message: string): RefineRule
```

The predicate is a function value, never source text. TypeScript rejects string arguments, and the runtime constructor rejects non-functions so plain JavaScript cannot bypass that boundary. The rule
records the intrinsic `Function.prototype.toString` result for inspection, but the current type-first emitter does not consume advanced rules. `validateObject` invokes the supplied predicate
synchronously and reports `message` on failure.

## 2. Transforms

```ts
transform(apply: (value: unknown) => unknown): TransformRule
```

The conversion is also a function value and the constructor rejects source strings through both the TypeScript and JavaScript surfaces. The returned rule exposes `apply` and records its intrinsic
source. No current validator or emitter path applies the rule, so callers that invoke `apply` do so explicitly.

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
