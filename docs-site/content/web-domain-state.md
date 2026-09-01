Model domain state so that **illegal transitions fail to compile**. `@zmdb/app` uses branded (phantom) types: a `DraftOrder` and a `PaidOrder` are distinct types even though both are just `Order` at
runtime. Branding erases completely — **zero runtime cost** beyond the value itself — and you never write an `as` cast.

## Branded states

```ts
import { defineState, transition, type Brand } from '@zmdb/app/state';

interface Order {
  id: number;
  status: 'draft' | 'paid';
  total: number;
}

// Basic state definition (unconditional branding / primitive branding)
const UserId = defineState<'UserId', string>('UserId');

// State definition with discriminant keying and validation predicates
const Draft = defineState<'Draft', Order>('Draft', {
  discriminant: ['status', 'draft'],
  predicate: o => o.total > 0,
});

const Paid = defineState<'Paid', Order>('Paid', {
  discriminant: ['status', 'paid'],
  predicate: o => o.total > 0,
});

type DraftOrder = Brand<Order, 'Draft'>;
type PaidOrder = Brand<Order, 'Paid'>;
```

## Constructing states (no `as`)

States are built through a **checked factory**, so you never cast:

```ts
const order = Draft.create({ id: 1, status: 'draft', total: 10 }); // DraftOrder
Draft.is(order); // type guard → narrows to DraftOrder
```

Calling `create` runs structural verification against configured discriminant properties and predicates. If verification fails, `create` throws a detailed `TypeError` (identifying the state name and failure cause). On success, it preserves object identity with zero runtime object allocations.

## Declaring transitions

`transition(from, to, fn)` produces a function that **only accepts the `from` state**. Applying it to any other state is a compile error, and there is simply no function for an undeclared edge:

```ts
const pay = transition(Draft, Paid, o => ({ ...o, status: 'paid' as const }));

const draft = Draft.create({ id: 1, status: 'draft', total: 10 });
const paid = pay(draft); // ✅ PaidOrder

// pay(paid);  // ✗ compile error — 'pay' expects a Draft order, not a Paid one
```

This makes "pay an already-paid order" or "ship an unpaid order" **unrepresentable** in code that type-checks.

## Design notes

- **Compile-time branding with structural verification.** Brands are phantom; `create` validates structural requirements and preserves object identity, so a state machine adds **0 bytes** and **0 ns object allocation cost** to valid payloads.
- **No `as` on the consumer surface** — construction goes through `create`. (The framework contains one isolated, documented brand-attach boundary internally.)
- Granular import: `import { defineState } from '@zmdb/app/state'`.

## Cross-links

- [Dependency injection](./web-di.html)
- [@zmdb/web overview](./web-overview.html)
