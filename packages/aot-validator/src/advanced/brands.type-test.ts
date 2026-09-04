// Type-level tests for branded types (#49). No runtime code: a *compilation*
// gate run by `yarn typecheck`, and therefore by CI. The claim — nominal typing
// with zero runtime footprint — is entirely a type-level one, so asserting it
// with `expectTypeOf` inside a `.spec.ts` (a runtime no-op) checked nothing.
import type { Equal, Expect, ExpectNot, Extends } from '@zmdb/schema-core';

import type { Brand } from './index.js';

type UserId = Brand<number, 'UserId'>;
type OrderId = Brand<number, 'OrderId'>;

// A brand is assignable to its base (it erases at runtime) …
export type _Brand1 = Expect<Extends<UserId, number>>;
// … but the base is not assignable to the brand: that is the whole point.
export type _Brand2 = ExpectNot<Extends<number, UserId>>;
// Two brands over the same base are distinct types.
export type _Brand3 = ExpectNot<Equal<UserId, OrderId>>;
export type _Brand4 = ExpectNot<Extends<UserId, OrderId>>;
// Branding is idempotent per tag.
export type _Brand5 = Expect<Equal<Brand<number, 'UserId'>, UserId>>;

declare const uid: UserId;
// @ts-expect-error — a plain number cannot stand in for a branded id.
export const _crossAssign: OrderId = uid;
// Arithmetic still works, and yields the *base* type (brands are not closed
// under operators — assigning the result back needs an explicit re-brand).
export const _asBase: number = uid + 1;
