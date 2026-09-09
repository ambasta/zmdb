// Tests (#269) for compile-time domain state machines: runtime identity.
// Legal/illegal transitions are type-level claims, asserted in
// `state.type-test.ts` and compiled by `yarn typecheck`.
// Per ./SPEC.md and #769.
import { describe, it, expect } from 'vitest';

import { Draft, Paid, pay, type Order } from './fixtures.js';
import { defineState, transition, type Brand } from './index.js';

describe('@zmdb/app state: branding erases at runtime', () => {
  it('create returns the very object it was given (zero-cost brand)', () => {
    const base = { id: 1, total: 10 };
    const draft: Brand<Order, 'Draft'> = Draft.create(base);
    expect(draft).toEqual(base);
    expect(draft).toBe(base); // object identity preserved
    expect(Object.keys(draft)).toEqual(['id', 'total']); // no brand property
  });
});

describe('@zmdb/app state: defineState', () => {
  interface Ticket {
    readonly id: number;
  }

  it('brands without touching the value, so create is an identity at runtime', () => {
    // `toBe`, not `toEqual`: the SPEC's claim is zero cost, and a copy would satisfy a deep
    // comparison while doubling the allocations on a hot path and breaking reference equality
    // for anything holding the value already.
    const Open = defineState<'Open', Ticket>();
    const base: Ticket = { id: 1 };
    expect(Open.create(base)).toBe(base);
    expect(Object.getOwnPropertySymbols(Open.create(base))).toEqual([]);
    expect(JSON.stringify(Open.create(base))).toBe('{"id":1}');
  });

  it('gives every state its own maker, and they are not the same object', () => {
    const Open = defineState<'Open', Ticket>();
    const Closed = defineState<'Closed', Ticket>();
    expect(Open).not.toBe(Closed);
    expect(Open.create).not.toBe(Closed.create);
  });

  it('runs the transition function and rebrands what it returned', () => {
    // Not the argument: a transition is free to return a new object, and the brand has to
    // follow the returned value rather than the one that went in.
    const Open = defineState<'Open', Ticket>();
    const Closed = defineState<'Closed', Ticket>();
    const close = transition(Open, Closed, ticket => ({ id: ticket.id + 1 }));
    const opened = Open.create({ id: 1 });
    const closed = close(opened);
    expect(closed).toEqual({ id: 2 });
    expect(closed).not.toBe(opened);
  });
});

describe('@zmdb/app state: transitions', () => {
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
});
