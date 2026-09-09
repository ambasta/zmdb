Model domain state so that **illegal transitions fail to compile**. `@zmdb/app` uses branded (phantom) types: a `DraftOrder` and a `PaidOrder` are distinct types even though both are just `Order` at
runtime. Branding erases completely — **zero runtime cost** beyond the value itself — and you never write an `as` cast.

## Branded states

```ts {"mode":"compile","id":"example-001"}
import { defineState, transition, type Brand } from '@zmdb/app/state';

interface Order {
  id: number;
  total: number;
}

const Draft = defineState<'Draft', Order>();
const Paid = defineState<'Paid', Order>();

type DraftOrder = Brand<Order, 'Draft'>;
type PaidOrder = Brand<Order, 'Paid'>;
```

## Constructing states (no `as`)

States are built through a **typed factory** that intentionally brands an already typed base value:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies Draft; this excerpt does not repeat those declarations."}
const order = Draft.create({ id: 1, total: 10 }); // DraftOrder
```

There is no `State.is`: phantom brands cannot be recognized at runtime. Validate unknown input with the existing generated `is<T>`/`assert<T>` or decoder for the base shape and any literal
discriminant first. That validation does not establish transition history. After the domain authorization decision, call `create` deliberately; it returns the same value without runtime validation.

## Declaring transitions

`transition(from, to, fn)` produces a function that **only accepts the `from` state**. Applying it to any other state is a compile error, and there is simply no function for an undeclared edge:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies Draft, Paid, transition; this excerpt does not repeat those declarations."}
const pay = transition(Draft, Paid, o => ({ ...o, paidAt: Date.now() }));

const draft = Draft.create({ id: 1, total: 10 });
const paid = pay(draft); // ✅ PaidOrder

// pay(paid);  // ✗ compile error — 'pay' expects a Draft order, not a Paid one
```

This makes "pay an already-paid order" or "ship an unpaid order" **unrepresentable** in code that type-checks.

## Design notes

- **Compile-time only.** Brands are phantom; `create` is an identity at runtime, so a state machine adds **0 bytes** to your objects.
- **No `as` on the consumer surface** — construction goes through `create`. (The framework contains one isolated, documented brand-attach boundary internally.)
- Granular import: `import { defineState } from '@zmdb/app/state'`.

## Cross-links

- [Dependency injection](./web-di.html)
- [@zmdb/web overview](./web-overview.html)
