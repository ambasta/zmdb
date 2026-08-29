# AOT JSON Serialization — Frozen Spec (Issue #51)

> Status: **FROZEN** for TDD. Implementation (#52–#55) must satisfy this spec.
> Part of `@zmdb/aot-validator`. Targets: Node 26+, ESM, TS 7.

## 1. stringify<T>

`stringify(value)` produces a JSON string. For known shapes the transformer emits
straight-line string concatenation; the runtime fallback here must be
byte-identical to `JSON.stringify` for all supported values.

## 2. Escaping rules (frozen)

- Escape `"` → `\"`, `\` → `\\`.
- Control chars U+0000–U+001F use `\uXXXX` (except `\b \t \n \f \r` short forms).
- Non-ASCII passes through as UTF-8 (matches `JSON.stringify` default).
- `undefined` object properties are **omitted**; `undefined` array items → `null`.
- `bigint` → throws `TypeError` (JSON has no bigint), matching a documented policy.

## 3. assertStringify<T>

Validates the value (reusing the validation engine) then serializes. On invalid
input throws a structured error; on valid input equals `stringify` output.

## 4. parse<T>

`parse(text)` → `{ success, data?, issues? }`. Parses JSON then validates into `T`.
Malformed JSON or validation failure yields `success:false` with issues.

## 5. Correctness contract

For all supported values `v`: `JSON.parse(stringify(v))` deep-equals `v`, and
`stringify(v) === JSON.stringify(v)` on the fixture set.

## 6. Non-goals (rejected)

- Protocol Buffers. Reflection-driven generic serializer retained at runtime.
