# AOT Validator Build Plugin — Frozen Spec (Issue #79)

> Status: **FROZEN** for TDD. Implementation (#80–#83) must satisfy this spec.
> Part of `@zmdb/aot-validator`. Targets: Node 26+, ESM, TS 7.
> Motivation: the shipped runtime validator loses to zod v4; the AOT path (proven
> in benchmarks/RESULTS.md as a hand-inlined preview) must be produced by a REAL
> build plugin. This freezes that plugin's contract.

## 1. Plugin surface

The transformer is packaged for both `ts-patch`/`ttypescript` and `unplugin`:

```ts
// ts-patch (tsconfig "plugins")
{ "transform": "@zmdb/aot-validator/plugin", "type": "program" }

// unplugin (vite/esbuild/webpack/rollup)
import { zmdbAot } from '@zmdb/aot-validator/unplugin';
```

`createTransformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile>`
is the core; the packaging wrappers adapt it.

## 2. Intercepted calls

The transformer recognizes generic calls resolved from `@zmdb/aot-validator`:
`is<T>(x)`, `assert<T>(x)`, `validate<T>(x)`, `equals<T>(x)`, `assertEquals<T>(x)`.
It reads `T` from the TS checker and replaces the call with inlined JS.

## 3. Emitted-JS contract (frozen)

For `is<T>(x)` where `T = { a: number; b: string }` the transformer emits an
**inline, monomorphic, allocation-free, early-exit** boolean expression — NOT a walk over
a runtime witness:

```
is<T>(x)  →  (typeof x === "object" && x !== null
              && typeof x.a === "number"
              && typeof x.b === "string")
```

- No object/array allocation on the success path.
- Nested objects recurse inline; arrays emit an inline `for` with early return.
- `assert<T>` wraps the inline check with a structured throw on failure.
- `equals/assertEquals` add inline excess-key checks (strict).

## 4. Golden fixtures (before → after)

```
BEFORE: const ok = is<{ n: number }>(input);
AFTER:  const ok = (typeof input === "object" && input !== null && typeof input.n === "number");

BEFORE: const v = assert<{ s: string }>(input);
AFTER:  const v = ((() => { if (!(typeof input === "object" && input !== null && typeof input.s === "string")) throw new AssertError(...); return input; })());
```

Identity: a source with no zmdb validator calls is returned unchanged.

## 5. Benchmark acceptance target (frozen)

Re-running the moltar suite with the transformer-built output MUST show, for the
fixed data model:

- AOT `assert`/`is` ≥ **5×** the runtime path, and
- AOT within **2×** of TypeBox-JIT on `assertLoose`.

If unmet, #83 documents why and the architecture claim is revised honestly
(no silent overclaim).

## 6. Non-goals (rejected)

- No walk over a runtime witness on the emitted hot path (that is the runtime fallback).
- No async validation. No reflection at runtime.
