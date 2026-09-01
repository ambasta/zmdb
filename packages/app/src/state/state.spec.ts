// Tests (#269) for compile-time domain state machines: runtime identity and
// narrowing. Legal/illegal transitions are type-level claims, asserted in
// `state.type-test.ts` and compiled by `yarn typecheck`.
// Per ./SPEC.md.
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
    // And yet the values they make are indistinguishable at runtime, which is the trade: the
    // brand is a compile-time fact, so `is` cannot tell one state from another and does not
    // claim to. Keeping states apart is `transition`'s signature's job, not this predicate's.
    expect(Closed.is(Open.create({ id: 1 }))).toBe(true);
  });

  it('is() answers for anything that exists, and nothing that does not', () => {
    const Open = defineState<'Open', Ticket>();
    expect(Open.is({ id: 1 })).toBe(true);
    expect(Open.is(0)).toBe(true);
    expect(Open.is(null)).toBe(false);
    expect(Open.is(undefined)).toBe(false);
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

  it('is() narrows a value to the branded state', () => {
    const draft = Draft.create({ id: 3, total: 30 });
    expect(Draft.is(draft)).toBe(true);
  });
});

describe('@zmdb/web state: discriminant & predicate state guard', () => {
  interface DiscrOrder {
    id: number;
    status: 'draft' | 'paid' | 'shipped';
    total: number;
  }

  it('evaluating state guards against primitive values, null, or undefined returns false without throwing exceptions', () => {
    const DraftState = defineState<'Draft', DiscrOrder>({
      discriminant: ['status', 'draft'],
      predicate: o => o.total > 0,
    });

    expect(DraftState.is(null)).toBe(false);
    expect(DraftState.is(undefined)).toBe(false);
    expect(DraftState.is(42)).toBe(false);
    expect(DraftState.is('draft')).toBe(false);
    expect(DraftState.is(true)).toBe(false);
    expect(DraftState.is(Symbol('draft'))).toBe(false);
  });

  it('rejects plain non-nullish objects that do not contain expected discriminant key or value', () => {
    const DraftState = defineState<'Draft', DiscrOrder>({
      discriminant: ['status', 'draft'],
    });

    // Missing discriminant key
    expect(DraftState.is({ id: 1, total: 100 })).toBe(false);

    // Wrong discriminant value
    expect(DraftState.is({ id: 1, status: 'paid', total: 100 })).toBe(false);

    // Correct discriminant key and value
    expect(DraftState.is({ id: 1, status: 'draft', total: 100 })).toBe(true);
  });

  it('supports discriminant configuration as object or property key', () => {
    const DraftObj = defineState<'Draft', DiscrOrder>({
      discriminant: { key: 'status', value: 'draft' },
    });
    expect(DraftObj.is({ id: 1, status: 'draft', total: 50 })).toBe(true);
    expect(DraftObj.is({ id: 1, status: 'paid', total: 50 })).toBe(false);

    const DraftKeyOnly = defineState<'Draft', DiscrOrder>({
      discriminant: 'status',
    });
    expect(DraftKeyOnly.is({ id: 1, status: 'draft', total: 50 })).toBe(true);
    expect(DraftKeyOnly.is({ id: 1, total: 50 })).toBe(false);
  });

  it('executes user-defined predicate functions when evaluating untyped inputs', () => {
    const ValidatedDraft = defineState<'Draft', DiscrOrder>({
      discriminant: ['status', 'draft'],
      predicate: order => order.total > 0 && order.id > 0,
    });

    // Fails predicate (total <= 0)
    expect(ValidatedDraft.is({ id: 1, status: 'draft', total: -5 })).toBe(false);

    // Fails predicate (id <= 0)
    expect(ValidatedDraft.is({ id: -1, status: 'draft', total: 10 })).toBe(false);

    // Passes predicate and discriminant
    expect(ValidatedDraft.is({ id: 1, status: 'draft', total: 25 })).toBe(true);
  });

  it('creating state instances throws when structural verification fails', () => {
    const ValidatedDraft = defineState<'Draft', DiscrOrder>({
      discriminant: ['status', 'draft'],
      predicate: o => o.total > 0,
    });

    expect(() => ValidatedDraft.create({ id: 1, status: 'paid', total: 10 } as unknown as DiscrOrder)).toThrow(
      TypeError,
    );

    expect(() => ValidatedDraft.create({ id: 1, status: 'draft', total: -10 })).toThrow(TypeError);
  });

  it('creating state instances and performing checks adds zero additional runtime object allocations and preserves object identity', () => {
    const DraftState = defineState<'Draft', DiscrOrder>({
      discriminant: ['status', 'draft'],
      predicate: o => o.total > 0,
    });

    const rawInput: DiscrOrder = { id: 100, status: 'draft', total: 250 };
    const keysBefore = Object.keys(rawInput);

    expect(DraftState.is(rawInput)).toBe(true);
    const created = DraftState.create(rawInput);

    // Object identity preserved
    expect(created).toBe(rawInput);
    // Keys unmodified
    expect(Object.keys(created)).toEqual(keysBefore);
  });

  it('state transitions pass returned values through structural verification while preserving object identity', () => {
    const DraftState = defineState<'Draft', DiscrOrder>({
      discriminant: ['status', 'draft'],
    });
    const PaidState = defineState<'Paid', DiscrOrder>({
      discriminant: ['status', 'paid'],
      predicate: o => o.total > 0,
    });

    const markPaid = transition(DraftState, PaidState, order => ({
      ...order,
      status: 'paid' as const,
    }));

    const draft = DraftState.create({ id: 1, status: 'draft', total: 99 });
    const paid = markPaid(draft);

    expect(PaidState.is(paid)).toBe(true);
    expect(paid.status).toBe('paid');
    expect(paid.total).toBe(99);

    // If transition function fails structural verification of target state
    const badMarkPaid = transition(DraftState, PaidState, order => ({
      ...order,
      status: 'draft' as const, // Wrong status for PaidState
    }));

    expect(() => badMarkPaid(draft)).toThrow(TypeError);
  });
});
