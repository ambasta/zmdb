# @zmdb/aot-validator — Frozen Spec (Issue #21)

> Status: **FROZEN** for TDD. Implementation (#22–#24) must satisfy this spec.
> Targets: Node 26+, ESM-only, TS 7 transformer semantics.

## 1. What the transformer intercepts

The transformer visits call expressions to these identifiers (imported from
`@zmdb/aot-validator`):

- `validate(rule, expr)` — boundary check, replaced by an inline boolean.
- `is<T>(expr)` — type guard (handled by validator-utilities spec #56).
- `assert<T>(expr)` — throwing guard (spec #56).

Only `validate(rule, expr)` primitive-tag inlining is in scope for #21–#24.

## 2. Primitive tag → emitted inline JS

Given `validate(tags.X(...), E)` where `E` is the checked expression, the
transformer replaces the entire call expression with the inline check below.
Emitted code MUST be allocation-free (no temporary objects/arrays).

| Tag call            | Emitted inline JS                          |
| ------------------- | ------------------------------------------ |
| `tags.Minimum(n)`   | `(typeof E === "number" && E >= n)`        |
| `tags.Maximum(n)`   | `(typeof E === "number" && E <= n)`        |
| `tags.MinLength(n)` | `(typeof E === "string" && E.length >= n)` |
| `tags.MaxLength(n)` | `(typeof E === "string" && E.length <= n)` |
| `tags.Pattern(re)`  | `(typeof E === "string" && /re/.test(E))`  |
| `tags.Enum(...v)`   | `(E === v0 \|\| E === v1 \|\| …)`          |

## 3. Transform test harness

`transformSource(code: string): string` runs the transformer over a TS source
string and returns the emitted JS (normalized, semicolons preserved). Used by
golden tests. This is the primary unit under #22.

## 4. Golden fixtures (before → after)

```
BEFORE: const ok = validate(tags.Minimum(0), input.price);
AFTER:  const ok = (typeof input.price === "number" && input.price >= 0);

BEFORE: const ok = validate(tags.MaxLength(255), input.name);
AFTER:  const ok = (typeof input.name === "string" && input.name.length <= 255);

BEFORE: const ok = validate(tags.Enum("a","b"), input.role);
AFTER:  const ok = (input.role === "a" || input.role === "b");
```

Identity: a source with **no** `validate()` calls is returned unchanged
(structurally equivalent output).

## 5. Runtime-safety fallback

Before transformation (dev / ts-node), `validate(rule, expr)` executes a real
runtime implementation returning the same boolean, so behavior is identical
pre- and post-transform. `tags.*` return plain rule descriptors.

## 6. Non-goals / anti-patterns (rejected)

- No async validation.
- No retained runtime parser objects in transformed output.
- No reflection.
