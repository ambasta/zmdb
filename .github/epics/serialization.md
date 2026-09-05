# [EPIC] High-Performance AOT JSON Serialization

## Goal

Provide typia-grade JSON serialization — a compile-time-generated, allocation-lean `stringify` that is dramatically faster than `JSON.stringify` for known schema types, and a matching typed
`parse`/decode path. Serialization code is emitted by `@zmdb/aot-validator`'s transformer from the schema/type.

## Parity Reference

- **typia**: `typia.json.stringify<T>()` (~200x faster than class-transformer), typed assertion+parse.

## Adopted (aligned with our architecture)

- AOT-generated `stringify<T>()` that emits straight-line string concatenation for known shapes.
- Optional validated stringify (`assertStringify`) that runs inline validation first.
- Typed `parse<T>()` / decode that validates on the way in (reuses advanced-validation).
- Response-DTO serialization hook usable directly by the repository layer's read paths.

## Explicitly Rejected (anti-patterns for us)

- ❌ Protocol Buffer support (out of scope for a data layer; typia itself deprioritized it).
- ❌ Reflection-driven generic serializer retained at runtime.

## Definition of Done

Fully resolved when all sub-issues are closed. Sub-issues collectively deliver:

1. Frozen spec for the serializer codegen contract + escaping rules.
2. AOT `stringify<T>` codegen.
3. Validated `assertStringify<T>`.
4. Typed `parse<T>` / decode path.
5. Benchmark suite vs native `JSON.stringify`.

## Constraints

- Correct JSON escaping / edge cases (unicode, control chars, bigint policy) frozen in spec.
- No per-call heap metadata.
- ESM-only, Node 26+, TypeScript 7.0+.

Sub-issues linked below as a task list.
