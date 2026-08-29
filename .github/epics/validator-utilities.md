# [EPIC] Validator Utility Surface (is / assert / validate variants, error reporting, random)

## Goal
Deliver typia's ergonomic validator entry points and developer utilities on top of the AOT engine (#3): boolean `is`, throwing `assert`, non-throwing `validate` (returns success/errors), plus `equals`/`assertEquals` (excess-property strictness), detailed structured error reporting, and schema-driven random data generation for tests.

## Parity Reference
- **typia**: `is<T>`, `assert<T>`, `validate<T>`, `equals<T>`, `assertEquals<T>`, `random<T>`, detailed error path reporting.
- **zod**: `parse` / `safeParse` ergonomics, `.issues` array with paths.

## Adopted (aligned with our architecture)
- `is<T>(input): input is T` — boolean guard (inline).
- `assert<T>(input): T` — throws structured error on failure.
- `validate<T>(input): { success; data?; errors? }` — non-throwing.
- `equals<T>` / `assertEquals<T>` — excess-property-strict variants.
- Structured error objects: `{ path, expected, value, message }`.
- `random<T>()` — schema/type-driven sample generator (test/dev utility).

## Explicitly Rejected (anti-patterns for us)
- ❌ Async validators.
- ❌ Runtime schema objects passed around at call sites (all `<T>` resolved by transformer).

## Definition of Done
Fully resolved when all sub-issues are closed. Sub-issues collectively deliver:
1. Frozen spec for each entry point's signature + error object shape.
2. `is<T>` guard codegen.
3. `assert<T>` + structured error throwing.
4. `validate<T>` non-throwing result.
5. `equals` / `assertEquals` excess-property strictness.
6. `random<T>` generator.

## Constraints
- Error paths must be exact (e.g. `input.orders[2].totalPrice`).
- Guards allocation-free on the success path.
- ESM-only, Node 26+, TypeScript 7.0+.

Sub-issues linked below as a task list.