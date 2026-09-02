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
