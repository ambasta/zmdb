// The order workflow both state tests are about.
//
// `state.spec.ts` checks what branding does at runtime (nothing) and
// `state.type-test.ts` checks which transitions compile. Those are two halves of
// one claim, so they read the states and edges from here rather than each
// declaring their own — the type-test's extra `Shipped` state exists precisely so
// there is a `Draft -> Shipped` edge that was never defined.
import { defineState, transition } from './index.ts';

export interface Order {
  id: number;
  total: number;
}

export const Draft = defineState<'Draft', Order>();
export const Paid = defineState<'Paid', Order>();
export const Shipped = defineState<'Shipped', Order>();

export const pay = transition(Draft, Paid, o => ({ ...o }));
export const ship = transition(Paid, Shipped, o => ({ ...o }));
