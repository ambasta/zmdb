# Validator Utility Surface — Frozen Spec (Issue #56)

> Status: **FROZEN** for TDD. Implementation (#57–#61) must satisfy this spec.
> Part of `@zmdb/aot-validator`. Targets: Node 26+, ESM, TS 7, synchronous.

## 1. Entry points

```ts
is<T>(input: unknown): input is T                       // boolean guard
assert<T>(input: unknown): T                            // throws on failure
validate<T>(input: unknown): ValidateResult<T>          // non-throwing
equals<T>(input: unknown): input is T                   // is<T> + no excess keys
assertEquals<T>(input: unknown): T                      // throwing strict
random<T>(): T                                          // sample generator
```

All `<T>` are resolved by the transformer; at runtime a schema descriptor is
threaded in by the compiler. The runtime fallbacks in this package accept an
explicit descriptor argument for testing.

## 2. Structured error + result shapes

```ts
interface ValidationIssue {
  readonly path: string; // exact path, e.g. input.orders[2].totalPrice
  readonly expected: string;
  readonly value: unknown;
  readonly message: string;
}

interface ValidateResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly ValidationIssue[];
}
```

- `assert` throws an `AssertError` whose `.issues[0]` carries the first failure
  with an exact path.
- `validate` collects **all** failures (never throws).
- `equals` / `assertEquals` additionally fail on excess properties.

## 3. random<T>

`random(descriptor)` produces a value that satisfies the descriptor by
construction, honoring tags (Minimum/MaxLength/Pattern/Enum). Contract:
`is(random(d), d) === true` for every seed.

## 4. Non-goals (rejected)

- Async validators. Runtime schema objects at call sites (resolved by transformer).
