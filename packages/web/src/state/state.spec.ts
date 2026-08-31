// Tests (#269) for compile-time domain state machines: runtime identity and
// narrowing. Legal/illegal transitions are type-level claims, asserted in
// `state.type-test.ts` and compiled by `yarn typecheck`.
// Per packages/web/src/state/SPEC.md.
import { describe, it, expect } from 'vitest';

import { defineState, transition, type Brand } from './index.ts';

interface Order {
  id: number;
  total: number;
}

const Draft = defineState<'Draft', Order>();
const Paid = defineState<'Paid', Order>();

// pay: Draft -> Paid
const pay = transition(Draft, Paid, o => ({ ...o }));

describe('@zmdb/web state: branding erases at runtime', () => {
  it('create returns the very object it was given (zero-cost brand)', () => {
    const base = { id: 1, total: 10 };
    const draft: Brand<Order, 'Draft'> = Draft.create(base);
    expect(draft).toEqual(base);
    expect(Object.keys(draft)).toEqual(['id', 'total']); // no brand property
  });
});

describe('@zmdb/web state: transitions', () => {
  it('applies a legal transition and preserves fields (runtime identity)', () => {
    const draft = Draft.create({ id: 1, total: 10 });
    const paid: Brand<Order, 'Paid'> = pay(draft);
    expect(paid.id).toBe(1);
    expect(paid.total).toBe(10);
  });

  it('rejects an illegal transition at compile time', () => {
    const paid = Paid.create({ id: 2, total: 20 });
    // @ts-expect-error — pay expects a Draft order, not a Paid one
    pay(paid);
    expect(true).toBe(true);
  });

  it('is() narrows a value to the branded state', () => {
    const draft = Draft.create({ id: 3, total: 30 });
    expect(Draft.is(draft)).toBe(true);
  });
});
