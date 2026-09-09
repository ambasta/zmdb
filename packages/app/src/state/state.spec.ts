// Tests (#269) for compile-time domain state machines: runtime identity and
// deliberate construction. Legal/illegal transitions are type-level claims, asserted in
// `state.type-test.ts` and compiled by `yarn typecheck`.
// Per ./SPEC.md.
import { describe, it, expect } from 'vitest';

import { zmdbAssertZmdbConfigData } from '../../../compiler/src/config/index.zmdb.generated.js';
import { Draft, Paid, pay, type Order } from './fixtures.js';
import { defineState, transition, type Brand } from './index.js';

describe('@zmdb/app state: branding erases at runtime', () => {
  it('create returns the very object it was given (zero-cost brand)', () => {
    const base = { id: 1, total: 10 };
    const draft: Brand<Order, 'Draft'> = Draft.create(base);
    expect(draft).toBe(base);
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

  it('does not expose a predicate for an erased brand', () => {
    expect(defineState<'Open', Ticket>()).not.toHaveProperty('is');
  });

  it('validates unknown base fields and literals before intentional branding', () => {
    expect(() => zmdbAssertZmdbConfigData({ schema: 42, naming: 'snake_case' })).toThrow();
    expect(() => zmdbAssertZmdbConfigData({ schema: 'schema.ts', naming: 'invalid' })).toThrow();
    const input: unknown = { schema: 'schema.ts', naming: 'snake_case' };
    const base = zmdbAssertZmdbConfigData(input);
    const Configured = defineState<'Configured', typeof base>();
    expect(Configured.create(base)).toBe(input);
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
