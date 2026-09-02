# Emission: IR → JavaScript — Spec (PRD §6.7 REQ-TF-8 … REQ-TF-11, §6.3 REQ-AV-4 … REQ-AV-7)

> Part of `@zmdb/aot-validator` (module `src/emit/`). `index.ts` is build-time only;
> `shape.ts` is imported by the runtime walker too and must stay compiler-free.
> Design: `DESIGN-type-first.md` §6, `PLAN-type-first.md` Phase 5.

## 1. Why it exists

`src/reflect/` turns a type into a `TypeIR`. This turns a `TypeIR` into JavaScript, so
that

```ts
const ok = is<{ n: number }>(input);
```

becomes

<!-- prettier-ignore -->
```text
const ok = typeof input === "object" && input !== null && !Array.isArray(input) && typeof input.n === "number" && !Number.isNaN(input.n);
```

with no call, no closure and no allocation. `src/utilities/index.ts` walks the same IR at
runtime for the un-built case, and the whole point of §3 is that the two answer alike.

Two files, and the split is the REQ-AV-4 mechanism rather than tidiness:

| File       | Responsibility                                                             |
| ---------- | -------------------------------------------------------------------------- |
| `shape.ts` | Every decision both walks make: issue text, discriminants, excess-ability. |
| `index.ts` | `Emitter` — the four emission targets, naming, hoisting, budget.           |

## 2. Four targets, one context

| Target   | Shape                           | Call sites                                 |
| -------- | ------------------------------- | ------------------------------------------ |
| `check`  | a boolean **expression**        | `is<T>`, and the gate of the other two     |
| `excess` | statements that `return false`  | the strict half of `equals`/`assertEquals` |
| `issues` | `(v, path, out) => void`        | `assert<T>` / `validate<T>`                |
| `sample` | an expression producing a value | `random<T>`                                |

They share one `Emitter` per file, which is what lets two `is<User>(…)` calls in the same
module compile to one hoisted `_zmdbCheckUser0`. Sharing is by fingerprint
(`target:JSON.stringify(node)`), so it survives two call sites that never mention each
other.

## 3. REQ-AV-4: the emitted and runtime paths agree

The requirement is stronger than "both return a boolean": identical accept/reject sets
**and** identical issue paths, over discriminated and undiscriminated unions alike
(REQ-AV-5). Two independent walks cannot be argued into that, so:

1. **Anything both decide lives in `shape.ts`.** `expectedOf`, `expectedForConstraint`,
   `messageFor`, `discriminantOf`, `expectedForDiscriminant`, `hasExcessCheck`. Neither
   walk has its own copy of an issue string or its own idea of what a discriminant is.
2. **`differential.spec.ts` measures it.** Both sides are handed the same `TypeIR` — the
   fixture harness routes a real call site through the same `Reflector` the transformer
   uses, so there is no second hand-written description to drift — and every case is run
   against its own corpus plus a 22-value wild corpus (`NaN`, `Infinity`, `[]`, `{}`,
   `new Date(0)`, a function, …). Four assertions per case: accept/reject parity, excess
   parity, `toEqual` on the whole issue array, and issues-empty ⟺ accepted.
3. **A cap only one path can honour is not a safety feature.** `safeTestPattern` used to
   refuse strings over 10 000 characters on the runtime `tags.Pattern` fallback. The
   emitted form is `/pat/.test(x)` and cannot refuse anything, so the same call answered
   `false` after a build and threw before one. It is deleted, not mirrored.

The suite is confirmed non-vacuous: removing the `!Number.isNaN` guard from the runtime
walker's scalar test fails 8 of its cases.

## 4. REQ-AV-7: structured issues, nothing paid for them on success

`assert<T>(x)` does not collect issues and then check whether the list is empty. It runs
the allocation-free `check`, and only when that says no does it walk `issues`:

<!-- prettier-ignore -->
```text
if (gate) return v;
const _e = []; _zmdbIssuesUser2(v, "input", _e);
throw new _zmdbAssertError(_e[0] ? _e[0].message : "validation failed", _e);
```

Valid input therefore allocates nothing at all — no array, no issue object, no closure —
and the second walk is paid for exactly where a throw was about to happen anyway.

Two tests, because one is not enough. `allocation.spec.ts` counts through a patched
`Array.prototype.push` (deterministic, unlike a heap delta, and every issue in both
implementations reaches its list through one). That cannot see the bare `const _e = []`
ahead of the early return, so `emit.spec.ts` also asserts the generated text before
`return input;` contains no `[]`, no `Issue` and no `new `.

Excess properties are one issue about the value as a whole, reported only when nothing
else was wrong: "you also passed `extra`" is noise next to "`email` is not a string".

## 5. Anonymous inlines, named hoists

A name is the signal that a type may recur or appear twice — `RefIR` exists because it
does. So `is<{ n: number }>(x)` stays a straight-line expression with no call in it, and
`is<User>(x)` gets one hoisted `_zmdbCheckUser0` that a `ref` can call.

Three deliberate exceptions:

- **Arrays always hoist.** A loop is not an expression, and `.every(cb)` allocates a
  closure per call. The emitted walk is an indexed `for`.
- **A named object's excess walk always hoists, even at the top.** Inlining it there
  would leave `excess:<name>` unregistered, so a `ref` back into its own body would find
  no helper and silently skip a check the runtime walker still performs.
- **A pure-delegation wrapper collapses.** An excess walk that is nothing but
  `if (!_zmdbExcessUser1(_v)) return false; return true;` hands back the inner function
  instead of wrapping it, which is one call per validation and nothing else.

`equals<T>(x)` reaches its second pass through that hoisted helper rather than inline
statements, so the whole form stays one expression: used in a condition it should not
have to pay for an IIFE.

## 6. Argument binding

A simple reference (`input`, `o.p`) is re-read rather than bound: the alternative is an
arrow wrapper around every `is<T>(o.p)`, which costs a call on the hot path for a
getter-with-side-effects shape that does not occur in validated data. That is also the
pre-existing behaviour of this transformer.

Anything with a call, an index or an operator in it is evaluated **exactly once**:
`assert<T>(next())` must not advance the iterator twice.

## 7. Strategy choices, and what decides them

| Situation                            | Emitted                                   | Why                                                                                                                                           |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| union of > 8 literals                | a hoisted `new Set([...]).has(v)`         | above the cutoff the set beats a `===` chain                                                                                                  |
| union of ≤ 8 literals                | `v === a \|\| v === b`                    | below it the chain is faster and reads better                                                                                                 |
| union of objects with a discriminant | one record test, then a `?:` ladder on it | one comparison instead of every arm in full                                                                                                   |
| union of objects without one         | `(...) \|\| (...)` in declaration order   | there is nothing to switch on                                                                                                                 |
| object, all properties required      | `for (const _ in v)` counting keys        | `check` already proved every declared key is there, so "no excess" is "the counts agree" — no `Set`, no allocation, and it bails one key over |
| object with an optional property     | a hoisted `Set` of declared keys          | a count cannot distinguish a missing declared key from an extra undeclared one                                                                |

The discriminant is worth more than speed: without one, a failing union can only say
"none of these arms matched" at the union's own path. With one, the failure is reported
_inside_ the arm the value was clearly trying to be, so `input.radius` gets named.

## 8. Refusals

An `unsupported` node is a build error, never a guess (plan D4). The walk records an
`EmitDiagnostic` — `path` plus prose — and returns `undefined`; the transformer then
leaves that call site alone, so the runtime fallback answers it and the build reports the
reason. `maxHelpers` (512) overruns are refusals by the same route, so a pathological
file fails rather than hangs.

An unparseable `pattern` is refused at emit time rather than trusted, because the
alternative is a syntax error inside the emitted module — a far worse message than
"invalid regular expression".

`escapePattern` exists for the same reason at a smaller scale: a `/` in a pattern must
not close the literal, and `\n`, `\r`, U+2028 and U+2029 must not end the line.

## 9. Verified

- [x] 107 assertions across three suites: `differential.spec.ts` (68), `emit.spec.ts` (34), `allocation.spec.ts` (5).
- [x] Both walks accept and reject the same values, and produce `toEqual`-identical issue arrays, for every case in the corpus plus 22 wild values appended to each.
- [x] Parity holds over a discriminated union, an undiscriminated one, a recursive type, a non-identifier key, an optional property and every constraint kind (REQ-AV-5).
- [x] The differential suite bites: removing the runtime walker's `!Number.isNaN` guard fails 8 cases.
- [x] `is<{ n: number }>` emits one expression with no call and no closure in it — asserted as an exact string.
- [x] `is<Point>` hoists exactly one helper and two call sites share it.
- [x] `equals<Point>` is one expression, not an IIFE, and its excess pass is not wrapped in a redundant delegation.
- [x] An array walk emits an indexed `for` and contains neither `.every(` nor `.some(`.
- [x] An all-required object's excess check counts keys (`!== 2) return false;`) and allocates no `Set`; one with an optional property allocates the `Set`.
- [x] Nothing is pushed onto any array while validating a valid input, over 1000 rounds, for all five call forms in both paths.
- [x] An invalid input produces exactly one issue, not a list of everything that was checked.
- [x] The text before `return input;` in the emitted `assert` contains no `[]`, no `Issue` and no `new `.
- [x] `validate<User>` blames `input.id` with `expected: 'minimum 1'`; `validate<Shape>` blames `input.kind` with `expected: '"circle" | "square"'`.
- [x] The emitted prelude imports `AssertError` from `@zmdb/aot-validator/errors`, and that subpath is published (`packaging.spec.ts`).
- [x] A file whose every call site was refused gets no prelude, so a helper reserved on the way to a refusal does not become dead code.

## 10. Non-goals (rejected)

- **A `.every(cb)` array check.** Shorter to emit, allocates a closure per call. The
  indexed loop is asserted, not preferred.
- **Mirroring the 10 000-character pattern cap.** §3.3. Deleting the cap was the only
  option that made both paths answer alike.
- **Reporting every issue for a union.** Both walks report the arm the discriminant chose,
  or one issue at the union's own path when there is none. Reporting all arms' complaints
  is a wall of text about types the value was never trying to be.
- **Checking excess properties on an undiscriminated union.** A value can satisfy several
  arms, so "which arm's property list is the declared one" has no answer. Neither path
  checks it, and `hasExcessCheck` is the single place that says so.
- **An IIFE around `equals<T>`.** §5.
- **Binding every argument.** §6.
- **A heap-delta measurement for REQ-AV-7.** Young-generation GC makes `heapUsed` deltas
  both noisy and potentially vacuous. The `push` counter is deterministic, and the gap it
  cannot see is covered structurally.
