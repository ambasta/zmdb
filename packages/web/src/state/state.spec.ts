// Tests (#269) for compile-time domain state machines — RED first (state exports
// absent). Type-level legal/illegal transitions + runtime identity/narrowing.
// Per packages/web/src/state/SPEC.md.
import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineState, transition, type Brand } from './index.ts';

interface Order {
  id: number;
  total: number;
}

const Draft = defineState<'Draft', Order>();
const Paid = defineState<'Paid', Order>();

// pay: Draft -> Paid
const pay = transition(Draft, Paid, (o) => ({ ...o }));

describe('@zmdb/web state: branding (type-level)', () => {
  it('two brands of the same base are not mutually assignable', () => {
    expectTypeOf<Brand<Order, 'Draft'>>().not.toEqualTypeOf<Brand<Order, 'Paid'>>();
  });

  it('create returns the branded state type', () => {
    const draft = Draft.create({ id: 1, total: 10 });
    expectTypeOf(draft).toEqualTypeOf<Brand<Order, 'Draft'>>();
  });
});

describe('@zmdb/web state: transitions', () => {
  it('applies a legal transition and preserves fields (runtime identity)', () => {
    const draft = Draft.create({ id: 1, total: 10 });
    const paid = pay(draft);
    expectTypeOf(paid).toEqualTypeOf<Brand<Order, 'Paid'>>();
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
