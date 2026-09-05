import type { TransactionContext } from '@zmdb/repository/transactions';
// Runtime contract for the command bus — ./SPEC.md §7 items 4, 6, 7, 8, 9,
// 10, 11 and 12. Items 1, 2, 3 and 5 are compile-time claims and live in ./cqrs.type-test.ts; they
// are the closure properties of the mapped type, which no runtime test can see.
//
// SPEC §3 is why there is no decorator anywhere in this file: "There is no decorator here at all."
// So unlike ../events/events.spec.ts this file needs no no-op decorator stub and no
// `Symbol.metadata` polyfill.
//
// No timer and no real database. §7 item 12 says so explicitly — "through a recording fake
// `transaction`, asserting the wrapper's own rejection path rather than a real database" — and the
// pipeline-order assertions are ordering assertions, driven by a shared log that each stage appends
// to, so they are statements about sequence and not about duration. The one clock in the file is
// `performance.now`, stubbed, because §4 makes `ms` part of the observable surface.
import { describe, expect, it, vi } from 'vitest';

import { createCommandBus, type CommandBusOptions, type CommandOutcome, type CommandRun } from './index.js';

// ---------------------------------------------------------------------------
// the map under test
// ---------------------------------------------------------------------------
// A TYPE ALIAS, not an interface, for the same reason ../events/events.spec.ts uses one: an
// interface declaration has no implicit index signature, so `interface Commands { … }` does not
// satisfy `CommandMap` — TS2344, "Index signature for type 'string' is missing", verified
// 2026-09-04. The spec and docs use the alias form; the type-test keeps that correction from
// regressing.
type Commands = {
  readonly publishPost: {
    readonly input: { readonly postId: number };
    readonly result: { readonly url: string };
  };
  readonly deleteUser: {
    readonly input: { readonly userId: string };
    readonly result: void;
  };
};

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
/** The identity validators SPEC §2 calls "the intended friction", spelled out once. */
const identityValidate: CommandBusOptions<Commands>['validate'] = {
  publishPost: raw => raw as { readonly postId: number },
  deleteUser: raw => raw as { readonly userId: string },
};

/**
 * A `transaction` wrapper that records what happened to it: whether it was entered, whether the
 * inner function rejected, and therefore whether a real implementation would have rolled back.
 * §7 item 12 asks for exactly this rather than a database, because what is under test is the
 * bus's own rejection path — that it lets the handler's rejection propagate OUT of the wrapper
 * instead of catching it and resolving, which is the mistake that silently commits.
 */
interface RecordingTransaction {
  readonly entered: () => number;
  readonly rejected: () => number;
  readonly committed: () => number;
  readonly tx: TransactionContext;
  readonly wrapper: (fn: (tx: TransactionContext) => Promise<unknown>) => Promise<unknown>;
}

function recordingTransaction(): RecordingTransaction {
  let entered = 0;
  let rejected = 0;
  let committed = 0;
  const tx: TransactionContext = {
    execute: () => Promise.resolve([]),
    savepoint: fn => fn(tx),
    repo: RepoClass => new RepoClass({ execute: () => Promise.resolve([]) }),
  };
  return {
    entered: () => entered,
    rejected: () => rejected,
    committed: () => committed,
    tx,
    wrapper: async fn => {
      entered += 1;
      try {
        const result = await fn(tx);
        committed += 1;
        return result;
      } catch (error) {
        rejected += 1;
        throw error;
      }
    },
  };
}

// ===========================================================================
// §7 item 4 — validate runs first
// ===========================================================================
describe('cqrs: validate (#593, SPEC §4 step 1, §7 item 4)', () => {
  it('validate runs before the handler and a rejected input never reaches it', async () => {
    // SPEC §4 step 1: "A validation failure never reaches the handler." Asserted as a spy with ZERO
    // calls, as §7 item 4 requires — the negative is the whole assertion, because an implementation
    // that validated *after* calling the handler would still reject and would still look correct
    // from the caller's side.
    const handler = vi.fn(() => Promise.resolve({ url: '/p/1' }));
    const bus = createCommandBus<Commands>(
      { publishPost: handler, deleteUser: () => Promise.resolve() },
      {
        validate: {
          ...identityValidate,
          publishPost: () => {
            throw new Error('postId must be a number');
          },
        },
      },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toThrow('postId must be a number');
    expect(handler).not.toHaveBeenCalled();
  });

  it('the handler receives the validator output, not the raw input', async () => {
    // The positive half, and the one that makes §4's ordering worth anything: "narrows to
    // `M[k]['input']`". A bus that ran the validator and then passed `raw` through would satisfy
    // the test above and be useless. Asserted on identity (`toBe`), so a structural clone does not
    // pass it either.
    const narrowed = { postId: 42 };
    const seen: unknown[] = [];
    const bus = createCommandBus<Commands>(
      {
        publishPost: input => {
          seen.push(input);
          return Promise.resolve({ url: `/p/${input.postId}` });
        },
        deleteUser: () => Promise.resolve(),
      },
      { validate: { ...identityValidate, publishPost: () => narrowed } },
    );

    const result = await bus.publishPost({ postId: 0 });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(narrowed);
    expect(result).toEqual({ url: '/p/42' });
  });

  it('a validator is called once per dispatch, with the raw argument', async () => {
    // §2: `validate` is total, so every dispatch goes through one. Twice would double a validator's
    // side effects (a coercion that increments, a schema that logs); zero would mean the bus
    // consulted a cache instead of the map.
    const raw = { postId: '7' };
    const calls: unknown[] = [];
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.resolve({ url: '/p/7' }), deleteUser: () => Promise.resolve() },
      {
        validate: {
          ...identityValidate,
          publishPost: seenRaw => {
            calls.push(seenRaw);
            return { postId: 7 };
          },
        },
      },
    );

    await bus.publishPost(raw as unknown as { readonly postId: number });

    expect(calls).toEqual([raw]);
  });
});

// ===========================================================================
// §7 items 6 and 7 — authorise
// ===========================================================================
describe('cqrs: authorise (#593, SPEC §4 step 2, §7 items 6 and 7)', () => {
  it('authorise runs after validate and receives the narrowed input', async () => {
    // SPEC §4 step 2's justification: "an authorisation rule reads fields (`input.postId`) and
    // reading an unvalidated field is exactly the confusion the ordering prevents." §7 item 6 asks
    // for the ARGUMENT IDENTITY, not just that it was called — so the assertion is `toBe(narrowed)`,
    // which is false for both a bus that authorises before validating and a bus that authorises
    // with the raw value afterwards.
    const narrowed = { postId: 42 };
    const order: string[] = [];
    const seen: unknown[] = [];
    const bus = createCommandBus<Commands>(
      {
        publishPost: () => {
          order.push('handler');
          return Promise.resolve({ url: '/p/42' });
        },
        deleteUser: () => Promise.resolve(),
      },
      {
        validate: {
          ...identityValidate,
          publishPost: () => {
            order.push('validate');
            return narrowed;
          },
        },
        authorise: (command, input) => {
          order.push(`authorise:${command}`);
          seen.push(input);
          return Promise.resolve();
        },
      },
    );

    await bus.publishPost({ postId: 0 });

    expect(order).toEqual(['validate', 'authorise:publishPost', 'handler']);
    expect(seen[0]).toBe(narrowed);
  });

  it('a throwing authorise prevents the handler and rethrows', async () => {
    // SPEC §4 step 2: "Authorisation throws to deny; a boolean return would let a forgotten `if`
    // around the call default to allow." So a rejection denies, the handler never runs, and the
    // caller sees the original error — a bus that swallowed it would return `undefined` for a
    // command that was refused, which is a fail-open.
    const handler = vi.fn(() => Promise.resolve({ url: '/p/1' }));
    const denied = new Error('forbidden');
    const bus = createCommandBus<Commands>(
      { publishPost: handler, deleteUser: () => Promise.resolve() },
      { validate: identityValidate, authorise: () => Promise.reject(denied) },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toBe(denied);
    expect(handler).not.toHaveBeenCalled();
  });

  it('authorise is optional and its absence allows the command', async () => {
    // §2 marks it optional. The failure mode worth pinning is the opposite of the usual one: a bus
    // that defaulted to deny when `authorise` was absent would make every unauthorised-by-design
    // command — an internal job step, a migration — fail with no rule anywhere to point at.
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.resolve({ url: '/p/1' }), deleteUser: () => Promise.resolve() },
      { validate: identityValidate },
    );

    await expect(bus.publishPost({ postId: 1 })).resolves.toEqual({ url: '/p/1' });
  });

  it('a denied command is not counted as a success by onCommand', async () => {
    // §4 step 4 says `onCommand` fires "always". A denial happens before the handler, so this is
    // the case an implementation that only wrapped the handler call would miss entirely — the
    // observability hole where authorisation failures do not appear in the command log at all.
    const outcomes: CommandOutcome[] = [];
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.resolve({ url: '/p/1' }), deleteUser: () => Promise.resolve() },
      {
        validate: identityValidate,
        authorise: () => Promise.reject(new Error('forbidden')),
        onCommand: outcome => void outcomes.push(outcome),
      },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toThrow('forbidden');

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.command).toBe('publishPost');
  });
});

// ===========================================================================
// §7 items 8, 9 and 10 — errors and observation
// ===========================================================================
describe('cqrs: rethrow and onCommand (#593, SPEC §4 steps 3-4, §7 items 8-10)', () => {
  it("the bus rethrows the handler's error unchanged", async () => {
    // SPEC §4: "The bus rethrows. It does not convert a failure into a result union, because the
    // caller is a controller whose error mapping already exists — `ExceptionFilter`
    // (../middleware/index.ts:27) turns a thrown value into a `WebResponse`." §7 item 8 asks for an
    // IDENTITY assertion, so `rejects.toBe`, not `rejects.toThrow`: a wrapped error loses whatever
    // discriminator the filter matches on, and every mapped status becomes a 500.
    const original = new Error('the handler failed');
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.reject(original), deleteUser: () => Promise.resolve() },
      { validate: identityValidate },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toBe(original);
  });

  it('a non-Error thrown by a handler also arrives unchanged', async () => {
    // `CommandOutcome`'s `error` is `unknown` for the same reason ../events/SPEC.md §3's is, so the
    // rethrow must not normalise. A bus that did `throw new Error(String(e))` would turn a thrown
    // `WebResponse` — which `ExceptionFilter` is built to pass through — into a 500.
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.reject('a bare string'), deleteUser: () => Promise.resolve() },
      { validate: identityValidate },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toBe('a bare string');
  });

  it('onCommand fires on success and on failure', async () => {
    // §7 item 9: two cases, `ok` correct in each. `ms` is asserted only as a number, because §4
    // sources it from the global `performance.now()` and a test that pinned a duration would be
    // asserting the speed of the machine. The stubbed-clock assertion is the next test.
    const outcomes: CommandOutcome[] = [];
    const bus = createCommandBus<Commands>(
      {
        publishPost: () => Promise.resolve({ url: '/p/1' }),
        deleteUser: () => Promise.reject(new Error('nope')),
      },
      { validate: identityValidate, onCommand: outcome => void outcomes.push(outcome) },
    );

    await bus.publishPost({ postId: 1 });
    await expect(bus.deleteUser({ userId: 'u1' })).rejects.toThrow('nope');

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toEqual({ command: 'publishPost', ok: true, ms: expect.any(Number) });
    expect(outcomes[1]?.ok).toBe(false);
    expect(outcomes[1]?.command).toBe('deleteUser');
    expect(outcomes[1]?.ok === false ? outcomes[1].error : undefined).toBeInstanceOf(Error);
  });

  it('onCommand fires before the bus rethrows', async () => {
    // §4 step 4, verbatim: "always, on success and on failure, before the bus rethrows", and §7 item
    // 9's second clause. The ordering is observable and it matters: an `onCommand` invoked in a
    // `finally` that runs after the rejection has already propagated means a caller's catch block
    // can act on a command the log has not recorded yet, which is how a metric and an alert
    // disagree about whether something happened.
    const order: string[] = [];
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.reject(new Error('boom')), deleteUser: () => Promise.resolve() },
      { validate: identityValidate, onCommand: () => void order.push('onCommand') },
    );

    await bus.publishPost({ postId: 1 }).catch(() => void order.push('caught'));

    expect(order).toEqual(['onCommand', 'caught']);
  });

  it('onCommand cannot suppress a failure', async () => {
    // §4: "`onCommand` is observation, not handling, which is why it cannot suppress." §7 item 10.
    // An `onCommand` that returns normally — its signature returns `void`, so it always does — must
    // leave the bus throwing. This is the assertion that stops the hook from becoming a de-facto
    // error handler, which would make failures depend on whether a logger was configured.
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.reject(new Error('boom')), deleteUser: () => Promise.resolve() },
      { validate: identityValidate, onCommand: () => undefined },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toThrow('boom');
  });

  it('a throwing onCommand does not replace the command outcome', async () => {
    // The implementation adopts the freeze's judgement call: "observation, not handling" means an
    // exception from the log must not become the command's error, or a broken metrics sink turns
    // every successful write into a failure for its caller.
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.resolve({ url: '/p/1' }), deleteUser: () => Promise.resolve() },
      {
        validate: identityValidate,
        onCommand: () => {
          throw new Error('the metrics sink is down');
        },
      },
    );

    await expect(bus.publishPost({ postId: 1 })).resolves.toEqual({ url: '/p/1' });
  });

  it('ms comes from performance.now and measures the dispatch', async () => {
    // SPEC §4: "`ms` is from the global `performance.now()`, matching the web benchmark clock.
    // `node:perf_hooks` is imported nowhere in this project and is not introduced here." Stubbing
    // the GLOBAL is therefore both the deterministic way to assert the duration and the assertion
    // that the source is the global — a bus that imported `node:perf_hooks` would be unaffected by
    // this spy and would report a real, non-25 duration.
    const nowSpy = vi.spyOn(globalThis.performance, 'now');
    try {
      nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_025);
      const outcomes: CommandOutcome[] = [];
      const bus = createCommandBus<Commands>(
        { publishPost: () => Promise.resolve({ url: '/p/1' }), deleteUser: () => Promise.resolve() },
        { validate: identityValidate, onCommand: outcome => void outcomes.push(outcome) },
      );

      await bus.publishPost({ postId: 1 });

      expect(outcomes[0]?.ms).toBe(25);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

// ===========================================================================
// §7 items 11 and 12 — transactions
// ===========================================================================
describe('cqrs: transactions are supplied, not assumed (#593, SPEC §5, §7 items 11 and 12)', () => {
  it('the handler receives ctx.tx when transaction is supplied', async () => {
    // SPEC §5, first half, and §7 item 11's first case. Asserted on identity: the handler gets the
    // SAME `TransactionContext` the wrapper created, because §5's whole composition — a repository
    // joining via `withTransaction`, an event joining via `emitInTransaction` — depends on it being
    // the one the wrapper will commit, not a copy.
    const recorder = recordingTransaction();
    const seen: CommandRun[] = [];
    const bus = createCommandBus<Commands>(
      {
        publishPost: (input, ctx) => {
          seen.push(ctx);
          return Promise.resolve({ url: `/p/${input.postId}` });
        },
        deleteUser: () => Promise.resolve(),
      },
      { validate: identityValidate, transaction: recorder.wrapper },
    );

    await bus.publishPost({ postId: 1 });

    expect(recorder.entered()).toBe(1);
    expect(recorder.committed()).toBe(1);
    expect(recorder.rejected()).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.command).toBe('publishPost');
    expect(seen[0]?.tx).toBe(recorder.tx);
  });

  it('the handler receives ctx.tx === undefined when transaction is not supplied', async () => {
    // §7 item 11's second case. SPEC §5: "If it is absent, `CommandRun.tx` is `undefined` and the
    // handler manages its own — which is what a command that writes nothing, or writes through two
    // stores, needs." So the bus must NOT invent one; `tx` is `undefined`, not a no-op stand-in,
    // because a handler cannot tell a fake transaction from a real one and would believe it was
    // protected.
    const seen: CommandRun[] = [];
    const bus = createCommandBus<Commands>(
      {
        publishPost: (input, ctx) => {
          seen.push(ctx);
          return Promise.resolve({ url: `/p/${input.postId}` });
        },
        deleteUser: () => Promise.resolve(),
      },
      { validate: identityValidate },
    );

    await bus.publishPost({ postId: 1 });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.tx).toBeUndefined();
  });

  it('a rejecting handler rolls back', async () => {
    // §7 item 12, and it asks for exactly this shape: "through a recording fake `transaction`,
    // asserting the wrapper's own rejection path rather than a real database." The recorder counts
    // a rejection and no commit, and the error still reaches the caller. The bug this catches is
    // the bus catching the handler's rejection *inside* the wrapper — to build a
    // `CommandOutcome` — and then rethrowing outside it, which commits the transaction and then
    // reports a failure. The whole database would be one silent bug away.
    const recorder = recordingTransaction();
    const original = new Error('write failed');
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.reject(original), deleteUser: () => Promise.resolve() },
      { validate: identityValidate, transaction: recorder.wrapper },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toBe(original);

    expect(recorder.entered()).toBe(1);
    expect(recorder.rejected()).toBe(1);
    expect(recorder.committed()).toBe(0);
  });

  it('validate and authorise run outside the transaction', async () => {
    // The implementation follows §4's order: the transaction opens only once the input is narrowed
    // and allowed. A rejected input inside a transaction would otherwise hold a connection and, on
    // postgres, a snapshot, for the duration of a schema check — and a denial would produce an
    // empty transaction for every probe an attacker sends.
    // Asserted through the recorder's entry count, which is 0 when the input is refused.
    const recorder = recordingTransaction();
    const bus = createCommandBus<Commands>(
      { publishPost: () => Promise.resolve({ url: '/p/1' }), deleteUser: () => Promise.resolve() },
      {
        validate: {
          ...identityValidate,
          publishPost: () => {
            throw new Error('bad input');
          },
        },
        transaction: recorder.wrapper,
      },
    );

    await expect(bus.publishPost({ postId: 1 })).rejects.toThrow('bad input');
    expect(recorder.entered()).toBe(0);
  });

  it("the transaction wrapper's result is the command's result", async () => {
    // §5's wrapper is typed `(fn) => Promise<unknown>`, so the bus has to carry the handler's value
    // back out through an `unknown` and hand it to the caller as `M[K]['result']`. That crossing is
    // the one place the mapped type's guarantee is re-established by hand, so it is asserted: a bus
    // that returned the wrapper's value without threading the handler's would resolve `undefined`
    // for every transactional command and typecheck perfectly.
    const recorder = recordingTransaction();
    const bus = createCommandBus<Commands>(
      {
        publishPost: input => Promise.resolve({ url: `/p/${input.postId}` }),
        deleteUser: () => Promise.resolve(),
      },
      { validate: identityValidate, transaction: recorder.wrapper },
    );

    await expect(bus.publishPost({ postId: 9 })).resolves.toEqual({ url: '/p/9' });
  });

  it('a TransactionContext is structural, so the recording fake above is a real one', () => {
    // The green companion, and the reason §7 item 12 can ask for a fake at all: SPEC §5's claim
    // that `withTransaction`'s parameter is structural (`{ execute: Driver['execute'] }`) is what
    // makes a two-method object literal a legitimate `TransactionContext`. Verified 2026-09-04
    // against ../../../repository/src/transactions/index.ts:8-12 and ../../../repository/src/index.ts:135;
    // the compile-time form of the claim is in ../../../repository/src/outbox/outbox.type-test.ts.
    const recorder = recordingTransaction();
    expect(typeof recorder.tx.execute).toBe('function');
    expect(typeof recorder.tx.savepoint).toBe('function');
  });

  it('the bus is a plain value, not a container-owned singleton', () => {
    // SPEC §6's last non-goal: "No `CommandBus` on the container as a required provider. It is a
    // value produced by `createCommandBus` and registered like any other provider." So there is
    // nothing to import, nothing to reset between tests, and no module-level state — which is what
    // makes every `it.fails` above independent of test order. Asserted as the absence of any export
    // other than the factory: this file imports exactly one runtime value from the module under
    // test, and that fact is visible at the top of the file.
    expect(typeof createCommandBus).toBe('function');
  });
});
