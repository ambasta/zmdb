# `@zmdb/web` — domain state machines SPEC

> Compile-time domain state machines via branded/phantom types (epic #267).
> Frozen before code. Illegal transitions fail to **compile**; zero runtime cost
> beyond the value itself.

## Contract

### `Brand<T, B>`

A nominal type: `T` tagged with a unique phantom brand `B`, so
`Brand<Order, 'Draft'>` and `Brand<Order, 'Paid'>` are **incompatible** even
though both erase to `Order` at runtime.

### `defineState` — safe smart constructor (no `as`)

Because the no-`as` rule forbids `value as Brand<...>` in consumer code, states
are produced by a **checked factory**:

\`\`\`ts
const draft = defineState<'Draft', Order>(); // a State<'Draft', Order> maker
const order = draft.create({ ...orderFields }); // Brand<Order, 'Draft'> — no cast
\`\`\`

`draft.is(x)` is a type guard narrowing `unknown`/a base value to the branded
state. The maker never asserts on the consumer surface.

### `transition` — declared edges only

`transition(from, to, fn)` builds a function typed
`(s: Brand<T, From>) => Brand<T, To>`. Calling it with the wrong source state is
a **compile error**. Composing an undeclared edge is impossible because there is
no function for it.

- `pay = transition(DraftState, PaidState, (o) => ({ ...o, paidAt: Date.now() }))`
- `pay(draftOrder)` ✅ → `PaidOrder`
- `pay(paidOrder)` ✗ compile error (already Paid)

## Invariants

- **Branding is compile-time only**; branded values erase to their base type — 0
  runtime bytes/cost. `defineState().create` returns the value unchanged at
  runtime (identity), just retyped.
- **No `as`/`any`/`!` on the consumer surface.** Construction goes through the
  checked factory; the single unavoidable brand attach lives inside the factory
  as one documented boundary (ARCHITECTURE.md §2.1), never at a call site.
- No reflection.

## Acceptance

- Type-level: a legal transition compiles; an illegal one is
  \`@ts-expect-error\`. Two brands of the same base are not mutually assignable.
- Runtime: \`create\`/\`transition\` return the value with fields intact (identity /
  structural), \`is\` narrows correctly.
- No consumer-surface \`as\`; suite + typecheck green.

## Out of scope

Wiring state machines into controllers/pipeline (epics #272/#287); persistence.
