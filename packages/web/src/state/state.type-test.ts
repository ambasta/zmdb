// Type-level tests for compile-time domain state machines (#269). No runtime
// code: a *compilation* gate run by `yarn typecheck`, and therefore by CI.
//
// "Illegal transitions fail to compile" is a claim only the compiler can check,
// so the `expectTypeOf` blocks in `state.spec.ts` were decoration — vitest runs
// that file, and `expectTypeOf(...)` is a runtime no-op.
import type { Equal, Expect, ExpectNot, Extends } from '@zmdb/schema-core';

// pay: Draft -> Paid, ship: Paid -> Shipped. There is no Draft -> Shipped edge.
import { Draft, pay, ship, type Order } from './fixtures.js';
import { type Brand } from './index.js';

// --- branding --------------------------------------------------------------
export type _State1 = ExpectNot<Equal<Brand<Order, 'Draft'>, Brand<Order, 'Paid'>>>;
export type _State2 = ExpectNot<Extends<Brand<Order, 'Draft'>, Brand<Order, 'Paid'>>>;
// A branded state is still the base type (the brand erases at runtime).
export type _State3 = Expect<Extends<Brand<Order, 'Draft'>, Order>>;
// …but a plain base value is not a state: construction must go through `create`.
export type _State4 = ExpectNot<Extends<Order, Brand<Order, 'Draft'>>>;

// --- create / transition ---------------------------------------------------
export type _State5 = Expect<Equal<ReturnType<typeof Draft.create>, Brand<Order, 'Draft'>>>;
export type _State6 = Expect<Equal<ReturnType<typeof pay>, Brand<Order, 'Paid'>>>;
export type _State7 = Expect<Equal<Parameters<typeof pay>[0], Brand<Order, 'Draft'>>>;

declare const draft: Brand<Order, 'Draft'>;
export const _legal: Brand<Order, 'Shipped'> = ship(pay(draft));
// @ts-expect-error — ship is Paid -> Shipped; a Draft order cannot be shipped.
export const _illegal = ship(draft);
// @ts-expect-error — an unbranded order is not a Draft.
export const _unbranded = pay({ id: 1, total: 10 });

// `is` narrows to the branded state.
declare const value: unknown;
export const _narrowed: Brand<Order, 'Draft'> | undefined = Draft.is(value) ? value : undefined;
