# Validator Utility Surface — Spec (Issue #56; PRD §6.3 REQ-AV-1 … REQ-AV-7)

> Part of `@zmdb/aot-validator` (module `src/utilities/`). Runtime; bundled into an
> application. Must never reach the compiler — `.github/scripts/verify-exports.mjs`
> enforces it transitively.

## 1. Entry points

```ts
is<T>(input: unknown): input is T                       // boolean guard
assert<T>(input: unknown): T                            // throws on failure
validate<T>(input: unknown): ValidateResult<T>          // non-throwing
equals<T>(input: unknown): input is T                   // is<T> + no excess keys
assertEquals<T>(input: unknown): T                      // throwing strict
random<T>(): T                                          // sample generator
```

Each `<T>` is resolved by the transformer, which replaces the whole call with inlined
JavaScript (`../emit/SPEC.md`). A call the transformer did not reach — no plugin, a
refused type, a file outside the project — falls back to the function of the same name in
this module, which walks a `TypeIR` at runtime. The second argument is that IR: absent at
a real call site because the transform removed the call, and passed explicitly by tests.

## 1a. Depth-limited entry points (frozen — epic "Shallow validation")

```ts
isShallow<T, D extends number = 1>(input: unknown): input is T
assertShallow<T, D extends number = 1>(input: unknown): T
validateShallow<T, D extends number = 1>(input: unknown): ValidateResult<T>
```

Three shapes in the issue that proposed this are wrong against shipped code, and the corrections are
not cosmetic:

- **`depth` cannot be the second positional parameter.** That slot is the injected `TypeIR` witness (§1),
  and it is the mechanism the fallback walk depends on. A depth there would collide with it on the one
  path that exists precisely for when the transform did not run.
- **`assertShallow` returns `T`.** The shipped `assert` is not an `asserts input is T` signature; it
  returns the value. A new sibling with the other spelling would be the only member of the family that
  cannot be used as an expression.
- **The result type is `ValidateResult<T>`**, which is what this module exports. There is no
  `ValidationResult`.

### Depth is a type argument, not a runtime one

`D` is the second **type** argument, and that is the answer to the API-shape question rather than a
preference. A runtime argument cannot select emitted branches — the whole point is that the transformer
emits different code — and `emitFor` reads only `arguments[0]` today, so a second runtime argument is
silently dropped, which is exactly the silent fallback this epic must not have. A type argument is read
by the checker the same way `T` is, and it is a literal by construction.

Refusals, all at build time with a diagnostic naming the file and call site:

- `D` is not a numeric literal (a generic parameter, a `number`, an expression) — refused. It does not
  fall back to full depth, which would silently over-promise, and it does not fall back to `1`, which
  would silently under-check while still claiming `input is T`.
- `D` is not a positive integer — `0`, a negative, `1.5` — refused. Depth `0` would check nothing and
  return a narrowing.

`D` **larger** than the type's own nesting is not an error: the check is then complete, and the emitter
produces the same code `is<T>` would, deduplicated by the existing fingerprint cache (`../emit/SPEC.md`
§2). "Ask for more depth than exists" is a reasonable thing for generated code to do.

The fallback walk still needs the depth, since it has no emitted branch to read it from. It arrives as a
**third** parameter, after the witness, on these three functions only — never read at a real call site,
because the call is gone, and passed explicitly by tests exactly as the witness is.

### These are three new callees, and that has a visible cost

`CALLEES` in `../transformer.ts` has fifteen names, and
`it('names every transformed call, and every one of them is a function somebody can call', …)` in
`../transform-code.spec.ts` asserts that list literally. The three shallow functions are exported from the
same runtime utilities module as their full-depth siblings, and `zmdb-codegen` includes a non-default depth
in a generated wrapper's identity so two checks over one type cannot collapse onto one implementation.

The alternative was a second type argument on the existing `is`/`assert`/`validate` — no new callees, no
test churn. It is rejected because it makes every existing call site's strength depend on a default, and
because "this validator makes a weaker promise than its name suggests" is the one fact that must be
visible at the call site. A distinct name is the cheapest way to say it.

### What this is for, since the docs page argues against it

`docs-site/content/validators-shallow.md` says shallow checking is usually the wrong tool, and its
argument is correct as far as it goes: measured per byte, a nested object is not meaningfully worse than
a flat one, so "nesting is slow" does not motivate this. The motivation that survives is different and
narrower, and it is the one this spec commits to:

1. **Bounding work over data whose size you do not control.** A depth-1 check over an array is O(1) in
   the number of elements. No amount of emitter improvement makes a full check O(1).
2. **A terminating check for a recursive type**, where the full validator's cost is a property of the
   data rather than of the schema.

Neither is upstream parity: typia ships no `isShallow`, and nothing in `tests/api-coverage/inventory.mjs`
names one. So this is a zmdb-specific tool for two specific situations, not a headline, and the docs
should keep the caution it already has.

## 2. Structured error + result shapes

```ts
interface ValidationIssue {
  readonly path: string; // exact path, e.g. input.orders[2].totalPrice
  readonly expected?: string;
  readonly value?: unknown;
  readonly message: string;
}

interface ValidateResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly ValidationIssue[];
}
```

`ValidationIssue` is `@zmdb/schema-core`'s declaration, re-exported rather than
redeclared: a repository validation failure and a validator one are the same thing to a
caller catching them.

- `assert` throws an `AssertError` whose `.issues[0]` carries the first failure with an
  exact path.
- `validate` collects **all** failures (never throws).
- `equals` / `assertEquals` additionally fail on excess properties — as one issue about
  the value as a whole, and only when nothing else was wrong.

## 3. This walk is the other half of REQ-AV-4

The requirement is identical accept/reject sets _and_ identical issue paths between this
module and the emitted code. That is two independent walks over one IR, so everything both
of them decide is imported from `../emit/shape.ts` rather than written twice: the
`expected` text of every node kind, the `expected` text of every constraint, the
`message` derived from it, whether a union has a discriminant worth switching on, and
whether a node has an excess check at all.

`../emit/differential.spec.ts` feeds both paths the same IR and asserts the two answers
are `toEqual`-identical, so §3 is measured rather than claimed.

Two consequences that look like omissions and are not:

- **No input-length cap.** `tags.Pattern` used to route through a `safeTestPattern` that
  threw over 10 000 characters. Its emitted counterpart is `/pat/.test(x)` and has no such
  limit, so the same call answered `false` after a build and threw before one. The cap is
  gone; a cap only one of the two paths can honour is not a safety feature.
- **No excess check on an undiscriminated union.** A value can satisfy several arms, so
  "which arm's property list is the declared one" has no answer. `hasExcessCheck` is the
  single place that says so, and both walks ask it.

## 4. Nothing is allocated on the success path (REQ-AV-7)

`assert` and `validate` run `matches` — which builds nothing — and only walk
`collectIssues` once that has already said no. A valid input therefore allocates no issue
list, no issue object and no error. `../emit/allocation.spec.ts` counts this through a
patched `Array.prototype.push` for both paths at once.

## 5. random<T>

`random(ir)` produces a value that satisfies the IR by construction, honouring numeric
bounds, lengths and enum members. The contract is `is(random(ir), ir) === true`.

**It refuses rather than guesses.** Nothing here inverts a regular expression, so a
`pattern` constraint throws a named refusal instead of returning a plausible string. The
generator this replaced returned `'x'` for any pattern it did not recognise, which made
the single property it claimed false for most patterns. A `ref` with no terminating arm
is refused for the same reason: no finite value satisfies it.

Sampling is the one walk that needs no `RefTable`. A `ref` is where it stops — dropped by
the union above it, so `Node { next: Node | null }` terminates on `null`, or refused
outright — so there is never a name to resolve.

## 6. Verified

- [x] Both paths accept and reject the same values and produce identical issue arrays, over the differential corpus plus 22 wild values per case (`../emit/differential.spec.ts`).
- [x] Removing this walk's `!Number.isNaN` guard fails 8 differential cases, so the parity assertion bites.
- [x] Nothing is pushed onto any array while this walk validates a valid input, over 1000 rounds, for all five call forms.
- [x] An invalid input produces exactly one issue, not a list of everything that was checked.
- [x] A 20 000-character input gets the same answer from `validate(tags.Pattern(…), x)` as from the inlined form (`../regex-complexity.spec.ts`).
- [x] `is(random(ir), ir)` holds for every sampleable node kind; a `pattern` constraint and a non-terminating `ref` each throw a named refusal.
- [x] `AssertError` is the class the _emitted_ validator throws too, so `catch (e) { e instanceof AssertError }` behaves the same whether or not the build inlined anything.

## 7. Non-goals (rejected)

- **Async validators.** Every call form is a synchronous expression, which is what lets
  the transformer inline it.
- **Runtime schema objects at call sites.** The type is the schema; the IR argument exists
  for the fallback and for tests, not as an API.
- **A second `ValidationIssue` declaration.** §2.
- **An input-length cap.** §3.
- **A best-effort sample for a pattern.** §5.
