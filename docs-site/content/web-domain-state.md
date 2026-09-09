Model domain state so that **illegal transitions fail to compile**. `@zmdb/app` uses branded (phantom) types: a `DraftOrder` and a `PaidOrder` are distinct types even though both are just `Order` at
runtime. Branding erases completely — **zero runtime cost** beyond the value itself — and you never write an `as` cast.

## Branded states

```ts {"mode":"compile","id":"example-001"}
import { defineState, transition, type Brand } from '@zmdb/app/state';

interface Order {
  id: number;
  status: 'draft' | 'paid';
  total: number;
}

const Draft = defineState<'Draft', Order>();
const Paid = defineState<'Paid', Order>();

type DraftOrder = Brand<Order, 'Draft'>;
type PaidOrder = Brand<Order, 'Paid'>;
```

## Constructing states (no `as`)

States are built through a **checked factory**, so you never cast:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies Draft; this excerpt does not repeat those declarations."}
const order = Draft.create({ id: 1, status: 'draft', total: 10 }); // DraftOrder
```

Calling `create` attaches the brand at compile-time and returns the value unchanged at runtime (zero-cost identity). Base shape validation is performed prior to state construction using
`@zmdb/validator` (`is<T>` / `assert<T>`).

## Declaring transitions

`transition(from, to, fn)` produces a function that **only accepts the `from` state**. Applying it to any other state is a compile error, and there is simply no function for an undeclared edge:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies Draft, Paid, transition; this excerpt does not repeat those declarations."}
const pay = transition(Draft, Paid, o => ({ ...o, status: 'paid' as const }));

const draft = Draft.create({ id: 1, status: 'draft', total: 10 });
const paid = pay(draft); // ✅ PaidOrder

// pay(paid);  // ✗ compile error — 'pay' expects a Draft order, not a Paid one
```

This makes "pay an already-paid order" or "ship an unpaid order" **unrepresentable** in code that type-checks.

## Design notes

- **Compile-time branding.** Brands are phantom; `create` returns the value unchanged at runtime, so a state machine adds **0 bytes** and **0 ns** to valid payloads.
- **No `as` on the consumer surface** — construction goes through `create`. (The framework contains one isolated, documented brand-attach boundary internally.)
- Granular import: `import { defineState } from '@zmdb/app/state'`.

## Cross-links

- [Dependency injection](./web-di.html)
- [@zmdb/web overview](./web-overview.html)
