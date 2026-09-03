// Tests freeze (#593) for the application event bus — packages/web/src/events/SPEC.md §9 items
// 1, 2, 3, 4 (runtime half), 5, 7, 8, 9, 10 and 11. Items 4 (type half) and 6 are compile-time
// claims and live in ./events.type-test.ts.
//
// THE IDIOM, as in the two outbox files: ./index.ts does not exist, so every frozen export is
// declared here and initialised from `unimplemented()`, which throws. Tests that drive one are
// `it.fails` — the body typechecks against the signature the implementation must have, and the
// throw keeps the assertion in the summary line instead of hiding it behind `.skip`. Each one
// records what it produces today.
//
// ONE REFINEMENT the outbox files did not need. `@OnEvent` is applied at class-definition time, at
// module scope, so a throwing stub there would take the whole file down at import and every test
// in it would report as a collection error rather than as an expected failure. `OnEvent` is
// therefore a deliberate NO-OP stub, and the throwing stubs are the readers — `getEventHandlers`
// and `bind`. That keeps the failure inside the test that asserts it, which is the property the
// whole `it.fails` discipline exists for. When ./index.ts lands, `OnEvent` will also need
// `../polyfill.js` imported for `Symbol.metadata` (see ../gateways/index.ts:6); the stub does not
// touch metadata, so it does not.
//
// Nothing here uses a timer. §9 item 5's concurrency assertion is a mutual-flag deadlock — two
// handlers that each resolve what the other awaits — which is a property of the scheduling and not
// of the clock, and which hangs rather than flakes under a sequential implementation. It carries an
// explicit short timeout so that hang is a fast failure instead of the 5s default.
import { DatabaseSync } from 'node:sqlite';

import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { createTransactionalDb } from '@zmdb/repository/transactions';
import type { TransactionContext, TxConnection } from '@zmdb/repository/transactions';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// the frozen surface — SPEC §2, §3, §5, §6, verbatim. Delete when ./index.ts lands and use:
//
//   import {
//     createEvents,
//     getEventHandlers,
//     OnEvent,
//     type EmitReport,
//     type EventFailure,
//     type EventMap,
//     type Events,
//     type EventsOptions,
//     type ResolvedEventHandler,
//   } from './index.js';
// ---------------------------------------------------------------------------
function unimplemented(what: string): never {
  throw new Error(`unimplemented: ${what}`);
}

interface EventMap {
  readonly [event: string]: unknown;
}

interface EventFailure {
  readonly event: string;
  readonly handler: string;
  readonly error: unknown;
}

interface EmitReport {
  readonly delivered: number;
  readonly failures: readonly EventFailure[];
}

interface Events<M extends EventMap> {
  emit<K extends keyof M & string>(event: K, payload: M[K]): void;
  emitAndWait<K extends keyof M & string>(event: K, payload: M[K]): Promise<EmitReport>;
  on<K extends keyof M & string>(event: K, handler: (payload: M[K]) => void | Promise<void>): () => void;
  bind(instance: object): () => void;
  // SPEC §5. It is NOT in §2's interface block — see NOTES.md; §5 says only "available on an
  // `Events<M>` constructed with an outbox writer" and §2's `EventsOptions` has no such field, so
  // the `outbox` option below is this freeze's reading of §5 and needs confirming before the
  // implementation lands.
  emitInTransaction<K extends keyof M & string>(tx: TransactionContext, event: K, payload: M[K]): Promise<string>;
}

interface OutboxWriterLike {
  write(topic: string, payload: string): Promise<string>;
}

interface EventsOptions<M extends EventMap> {
  readonly onError: (failure: EventFailure) => void;
  readonly validate?: { readonly [K in keyof M]?: (raw: unknown) => M[K] };
  readonly outbox?: (tx: TransactionContext) => OutboxWriterLike;
}

interface ResolvedEventHandler {
  readonly event: string;
  readonly handlerName: string;
}

const createEvents: <M extends EventMap>(opts: EventsOptions<M>) => Events<M> = () => unimplemented('createEvents');

const getEventHandlers: (cls: abstract new (...args: never[]) => unknown) => readonly ResolvedEventHandler[] = () =>
  unimplemented('getEventHandlers');

// The no-op stub explained in the header. Signature is §6's, exactly.
function OnEvent(_event: string): (target: Function, context: ClassMethodDecoratorContext) => void {
  return () => undefined;
}

// ---------------------------------------------------------------------------
// the map under test, and the decorated class for §9 items 7 and 8
// ---------------------------------------------------------------------------
// A TYPE ALIAS, not an interface. `interface AppEvents { … }` does not satisfy `EventMap`'s index
// signature — TS2344 "Index signature for type 'string' is missing in type 'AppEvents'", verified
// 2026-09-04 — because only object-literal type aliases get an implicit index signature. SPEC §2's
// own prose and docs-site/content/web-events.md both write `interface AppEvents`, which does not
// compile against the frozen `EventMap`. See NOTES.md; this is a defect in the spec's example, not
// in the frozen type.
type AppEvents = {
  readonly 'post.published': { readonly id: number };
  readonly 'user.deleted': { readonly userId: string };
};

class PostSubscriber {
  readonly seen: string[] = [];

  @OnEvent('post.published')
  onPublished(payload: { readonly id: number }): void {
    this.seen.push(`published:${payload.id}`);
  }

  @OnEvent('user.deleted')
  onUserDeleted(payload: { readonly userId: string }): void {
    this.seen.push(`deleted:${payload.userId}`);
  }

  notAHandler(): void {
    this.seen.push('never');
  }
}

class Undecorated {
  onPublished(): void {
    // nothing
  }
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
function collector(): { readonly errors: EventFailure[]; readonly onError: (f: EventFailure) => void } {
  const errors: EventFailure[] = [];
  return { errors, onError: f => void errors.push(f) };
}

/** A promise plus its resolver. The only synchronisation primitive in this file. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function txConn(db: DatabaseSync): TxConnection {
  const driver = sqliteDriver(db);
  return {
    async raw(sql: string) {
      db.exec(sql);
    },
    execute: q => driver.execute(q),
  };
}

function outboxDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE zmdb_outbox (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
    delivered_at TEXT,
    last_error TEXT
  )`);
  return db;
}

/**
 * A hand-written outbox writer, so this file asserts the `Events<M>` path into the outbox without
 * depending on @zmdb/repository's outbox module — which #593 also freezes and which therefore does
 * not exist yet either. The SQL is deliberately the crudest possible: the real statement is the
 * outbox freeze's assertion (../../../query-compiler/src/outbox/outbox.spec.ts) and duplicating it
 * here would make one change break two suites.
 */
function handWrittenOutbox(tx: TransactionContext): OutboxWriterLike {
  return {
    async write(topic, payload) {
      const id = globalThis.crypto.randomUUID();
      await tx.execute({
        text: 'INSERT INTO zmdb_outbox(id, topic, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
        parameters: [id, topic, payload, 'pending', new Date().toISOString()],
      });
      return id;
    },
  };
}

// ===========================================================================
// §9 items 1, 2 and 3 — a handler's exception is data
// ===========================================================================
describe('events: a failing handler (#593, SPEC §3, §9 items 1-3)', () => {
  it.fails('a throwing handler does not prevent the others', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // Three handlers, the middle one throws, and the assertion is on the other two — SPEC §3's
    // isolation, which §7 gets for free from `Promise.allSettled` having no short circuit. Note the
    // assertion is on the SET of survivors, not on their order: §7 guarantees no order, so
    // asserting `['first', 'third']` as a sequence would be asserting an implementation detail
    // that the spec explicitly refuses to promise.
    const { errors, onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const ran: string[] = [];

    events.on('post.published', () => void ran.push('first'));
    events.on('post.published', () => {
      throw new Error('handler blew up');
    });
    events.on('post.published', () => void ran.push('third'));

    const report = await events.emitAndWait('post.published', { id: 1 });

    expect(ran.toSorted()).toEqual(['first', 'third']);
    expect(report.delivered).toBe(2);
    expect(report.failures).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it.fails('a throwing handler does not reject emitAndWait', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §3 refuses rethrowing the first failure, because with concurrent handlers "first" is a
    // race. So the promise RESOLVES and the failure is in the report. Written as
    // `.resolves`/`.rejects` rather than a try/catch, because a try/catch around an awaited call
    // passes vacuously if the call never rejects and never resolves either.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    events.on('post.published', () => Promise.reject(new Error('async blew up')));

    const report = await events.emitAndWait('post.published', { id: 1 });

    expect(report.delivered).toBe(0);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.event).toBe('post.published');
    // §3: `error` is `unknown` because a throw can be anything, so the test does not assume Error.
    expect(report.failures[0]?.error).toBeInstanceOf(Error);
  });

  it.fails('a handler that throws a non-Error is reported as thrown, not wrapped', async () => {
    // actual today: Error: unimplemented: createEvents.
    // SPEC §3's justification for `error: unknown`: "a `throw` can be anything. Narrowing it to
    // `Error` in the type would be a claim the runtime cannot keep." So the value arrives verbatim
    // — an implementation that wrapped it in `new Error(String(e))` would destroy it and would
    // make `unknown` a lie.
    const { errors, onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    events.on('post.published', () => {
      throw 'a bare string';
    });

    const report = await events.emitAndWait('post.published', { id: 1 });

    expect(report.failures[0]?.error).toBe('a bare string');
    expect(errors[0]?.error).toBe('a bare string');
  });

  it.fails('every failure reaches onError exactly once, and names the right handler', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // Two failing handlers, two calls, and `handler` identifies which. "Exactly once" is the
    // load-bearing half: a report AND an onError call for the same failure is correct, but two
    // onError calls for one failure means the sink double-pages, and a sink that cries wolf gets
    // muted, which returns us to §3's silent-swallow bug by a longer route.
    const { errors, onError } = collector();
    const events = createEvents<AppEvents>({ onError });

    events.on('post.published', function alpha() {
      throw new Error('alpha failed');
    });
    events.on('post.published', function beta() {
      throw new Error('beta failed');
    });

    const report = await events.emitAndWait('post.published', { id: 1 });

    expect(report.failures).toHaveLength(2);
    expect(errors).toHaveLength(2);
    expect(errors.map(f => f.handler).toSorted()).toEqual(['alpha', 'beta']);
    expect(errors.every(f => f.event === 'post.published')).toBe(true);
  });

  it.fails('onError also fires for a handler that failed under plain emit', async () => {
    // actual today: Error: unimplemented: createEvents.
    // The reason §3 makes `onError` required rather than defaulting to silence: `emit` returns
    // void, so the report is unreachable and the sink is the ONLY evidence a handler broke. If
    // onError only fired on the emitAndWait path, `emit` would be exactly the invisible-failure
    // bug the spec says it exists to prevent.
    const { errors, onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    events.on('post.published', function gamma() {
      throw new Error('gamma failed');
    });

    events.emit('post.published', { id: 1 });
    await vi.waitUntil(() => errors.length > 0);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.handler).toBe('gamma');
  });
});

// ===========================================================================
// §9 item 4 (runtime half) — emit returns void and never rejects
// ===========================================================================
describe('events: emit does not wait (#593, SPEC §4, §9 item 4)', () => {
  it.fails('emit returns void', () => {
    // actual today: Error: unimplemented: createEvents.
    // The runtime half; the type half — that `emit(…)` is not awaitable — is in
    // ./events.type-test.ts, because a runtime test cannot distinguish `void` from an ignored
    // promise once it has been discarded.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    events.on('post.published', () => undefined);

    expect(events.emit('post.published', { id: 1 })).toBeUndefined();
  });

  it.fails('a throwing handler under emit produces no unhandled rejection', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §4: "a method that returns void cannot be awaited by mistake and cannot produce an
    // unhandled rejection". Asserted directly against the process, because this is the failure mode
    // that takes a Node service down (`--unhandled-rejections=throw` is the default) and it cannot
    // be observed any other way.
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const { onError } = collector();
      const events = createEvents<AppEvents>({ onError });
      events.on('post.published', () => Promise.reject(new Error('rejected in the background')));

      events.emit('post.published', { id: 1 });
      // two macrotask turns: an unhandled rejection is reported after the microtask queue drains.
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it.fails('emit does not make its caller wait for a slow handler', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §4: "the emitter's caller must not pay for the handlers". Asserted without a clock: the
    // handler blocks on a deferred nobody has resolved, and the assertion is that `emit` has
    // already returned and the next statement runs. Under an awaiting implementation this line is
    // never reached and the test times out rather than passing by luck.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const gate = deferred();
    let entered = false;

    events.on('post.published', async () => {
      entered = true;
      await gate.promise;
    });

    events.emit('post.published', { id: 1 });
    expect(entered).toBe(true);
    gate.resolve();
  }, 1_000);
});

// ===========================================================================
// §9 item 5 — the concurrency assertion that pins §7
// ===========================================================================
describe('events: handlers run concurrently (#593, SPEC §7, §9 item 5)', () => {
  it.fails('handlers run concurrently', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §9 item 5, verbatim: "two handlers each resolving on the other's flag, which
    // deadlocks under any sequential implementation. This is the assertion that pins §7 rather
    // than describing it."
    //
    // Handler A resolves gateA then awaits gateB; handler B resolves gateB then awaits gateA.
    // Under `Promise.allSettled` both start, both flags get set, both finish. Under any
    // sequential implementation — `for (const h of handlers) await h(p)` — A is entered, awaits
    // gateB, and B never starts: the emit never settles. That is a hang, not a wrong value, so
    // the timeout below is what converts it into a failure. It is set short on purpose; the
    // default 5s would make a regression here cost five seconds of every CI run.
    //
    // No ordering is asserted, because §7 guarantees none. What is asserted is that both ran.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const gateA = deferred();
    const gateB = deferred();
    const finished: string[] = [];

    events.on('post.published', async () => {
      gateA.resolve();
      await gateB.promise;
      finished.push('A');
    });
    events.on('post.published', async () => {
      gateB.resolve();
      await gateA.promise;
      finished.push('B');
    });

    const report = await events.emitAndWait('post.published', { id: 1 });

    expect(finished.toSorted()).toEqual(['A', 'B']);
    expect(report.delivered).toBe(2);
    expect(report.failures).toEqual([]);
  }, 1_000);

  it.fails('a rejection does not short-circuit a concurrent sibling', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §7's closing claim: "`allSettled` rather than `all` is what gives §3 its isolation with
    // no extra machinery: a rejection cannot short-circuit the others". `Promise.all` would reject
    // as soon as the fast failing handler rejects, so the slow handler's push would never be
    // observed. The deferred is what makes the failure land FIRST, deterministically, which is the
    // only interleaving under which `all` and `allSettled` differ observably.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const slow = deferred();
    const survived: string[] = [];

    events.on('post.published', async () => {
      await slow.promise;
      survived.push('slow');
    });
    events.on('post.published', () => {
      slow.resolve();
      return Promise.reject(new Error('fast failure'));
    });

    const report = await events.emitAndWait('post.published', { id: 1 });

    expect(survived).toEqual(['slow']);
    expect(report.delivered).toBe(1);
    expect(report.failures).toHaveLength(1);
  }, 1_000);
});

// ===========================================================================
// §9 items 7 and 8 — @OnEvent and bind
// ===========================================================================
describe('events: @OnEvent and bind (#593, SPEC §6, §9 items 7 and 8)', () => {
  it.fails('getEventHandlers reads the class, not an instance', () => {
    // actual today: Error: unimplemented: getEventHandlers.
    //
    // SPEC §6: "Nothing scans." `getEventHandlers(cls)` takes the CLASS, the way
    // `getRoutes` (../routing/index.ts:106) and `getSubscriptions` (../gateways/index.ts:59) do.
    // The order is declaration order, which is what the sibling readers already guarantee, and
    // `notAHandler` is absent — the decorator is the registration, not the method's existence.
    expect(getEventHandlers(PostSubscriber)).toEqual([
      { event: 'post.published', handlerName: 'onPublished' },
      { event: 'user.deleted', handlerName: 'onUserDeleted' },
    ]);
  });

  it.fails('getEventHandlers returns [] for an undecorated class', () => {
    // actual today: Error: unimplemented: getEventHandlers.
    // The empty case, which is where a metadata reader usually throws instead: with no decorator
    // there is no `Symbol.metadata` on the class at all (../gateways/index.ts:60-63 handles both
    // `undefined` and `null`), so this is the assertion that stops a bind() on an ordinary
    // provider from crashing an application's startup.
    expect(getEventHandlers(Undecorated)).toEqual([]);
  });

  it.fails('bind registers every decorated handler and its disposer unregisters all of them', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §6's whole justification for the decorator: "`bind(this)` in `onModuleInit` is one line
    // that cannot be partially wrong: either every decorated handler is registered or none is." So
    // the count is asserted before AND after, on both events, because a disposer that unregisters
    // the first handler and leaks the rest is the bug that outlives a test suite.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const subscriber = new PostSubscriber();

    const dispose = events.bind(subscriber);
    await events.emitAndWait('post.published', { id: 7 });
    await events.emitAndWait('user.deleted', { userId: 'u1' });
    expect(subscriber.seen).toEqual(['published:7', 'deleted:u1']);

    dispose();
    await events.emitAndWait('post.published', { id: 8 });
    await events.emitAndWait('user.deleted', { userId: 'u2' });
    expect(subscriber.seen).toEqual(['published:7', 'deleted:u1']);
  });

  it.fails('a bound handler receives the emitting instance as its this', async () => {
    // actual today: Error: unimplemented: createEvents.
    // The mistake `bind` exists to avoid: registering `instance.onPublished` unbound gives a
    // handler whose `this` is undefined under a module in strict mode, so `this.seen.push` throws
    // and the failure surfaces as an EventFailure rather than as a wiring error. Asserted through
    // the observable effect on the instance.
    const { errors, onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const subscriber = new PostSubscriber();

    events.bind(subscriber);
    await events.emitAndWait('post.published', { id: 1 });

    expect(subscriber.seen).toEqual(['published:1']);
    expect(errors).toEqual([]);
  });

  it.fails('on returns a disposer that unregisters exactly one handler', async () => {
    // actual today: Error: unimplemented: createEvents.
    // §6: "`on` therefore stays public and first-class." Two handlers, one disposed, and the other
    // still fires — the assertion that the registry is keyed per registration and not per event.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const ran: string[] = [];

    const offFirst = events.on('post.published', () => void ran.push('first'));
    events.on('post.published', () => void ran.push('second'));

    offFirst();
    await events.emitAndWait('post.published', { id: 1 });

    expect(ran).toEqual(['second']);
  });

  it.fails('a disposer is idempotent', async () => {
    // actual today: Error: unimplemented: createEvents.
    // Calling it twice must not remove somebody else's handler, which is what a splice-by-index
    // implementation does on the second call. Cheap assertion, expensive bug.
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });
    const ran: string[] = [];

    const off = events.on('post.published', () => void ran.push('first'));
    events.on('post.published', () => void ran.push('second'));

    off();
    off();
    await events.emitAndWait('post.published', { id: 1 });

    expect(ran).toEqual(['second']);
  });
});

// ===========================================================================
// §9 items 9 and 10 — crossing into the outbox
// ===========================================================================
describe('events: emitInTransaction (#593, SPEC §5, §9 items 9 and 10)', () => {
  it.fails('emitInTransaction calls no in-process handler', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §5, the asymmetry "that would otherwise be found in production": an in-process handler
    // registered for the same event name does NOT see a transactionally emitted event. This is the
    // assertion that stops a handler which fires in tests and never in production, so it asserts
    // the absence directly rather than inferring it from a count.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError, outbox: handWrittenOutbox });
    const ran: string[] = [];
    events.on('post.published', () => void ran.push('in-process'));

    const id = await dbx.transaction(tx => events.emitInTransaction(tx, 'post.published', { id: 1 }));

    expect(ran).toEqual([]);
    expect(typeof id).toBe('string');
    const stored = db.prepare('SELECT id, topic, payload FROM zmdb_outbox').all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.['topic']).toBe('post.published');
    expect(stored[0]?.['id']).toBe(id);
  });

  it.fails("emitInTransaction's row is gone after a rollback", async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §5: "not delivered at all if the transaction rolls back". The outbox freeze
    // (../../../query-compiler/src/outbox/SPEC.md §9 item 1) owns the general guarantee; what this
    // asserts is that the `Events<M>` path actually reaches it rather than writing on its own
    // connection — a writer that opened its own connection would leave the row behind here and
    // pass every test in the outbox suite.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError, outbox: handWrittenOutbox });

    await expect(
      dbx.transaction(async tx => {
        await events.emitInTransaction(tx, 'post.published', { id: 1 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(db.prepare('SELECT * FROM zmdb_outbox').all()).toEqual([]);
  });

  it.fails('emitInTransaction serialises the payload as text, not as an object', async () => {
    // actual today: Error: unimplemented: createEvents.
    // The outbox `payload` column is `text` (outbox SPEC §2.3), so the crossing from a typed
    // payload to a string happens here, once, and the row holds JSON rather than a driver's
    // stringification of an object. Without this, `[object Object]` reaches the column and is only
    // discovered by a consumer.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError, outbox: handWrittenOutbox });

    await dbx.transaction(tx => events.emitInTransaction(tx, 'user.deleted', { userId: 'u-42' }));

    const payload = db.prepare('SELECT payload FROM zmdb_outbox').get() as { payload: string };
    expect(payload.payload).toBe('{"userId":"u-42"}');
  });

  it.fails('emitInTransaction on an Events built without an outbox is an error, not a silent no-op', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // JUDGEMENT CALL, flagged in NOTES.md. SPEC §5 says the method is "available on an `Events<M>`
    // constructed with an outbox writer" and says nothing about the other case, and the frozen
    // `Events<M>` in §2 does not make the method optional, so it is callable on every instance.
    // Rejecting is the only defensible behaviour: a silent no-op turns "this event is durable" into
    // "this event vanished", which is the one failure the outbox pattern exists to make impossible.
    // If the implementation prefers a compile-time split instead — two interfaces, one with the
    // method — this test should be deleted and replaced by a type-test.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));
    const { onError } = collector();
    const events = createEvents<AppEvents>({ onError });

    await expect(dbx.transaction(tx => events.emitInTransaction(tx, 'post.published', { id: 1 }))).rejects.toThrow(
      /outbox/i,
    );
  });
});

// ===========================================================================
// §9 item 11 — validate
// ===========================================================================
describe('events: validate (#593, SPEC §2, §9 item 11)', () => {
  it.fails('validate is applied when present', async () => {
    // actual today: Error: unimplemented: createEvents.
    // SPEC §2: validate exists for "an event re-emitted from a broker or a webhook, where the
    // payload really did arrive as unknown". So the handler sees the validator's RETURN value, not
    // the raw input — a validator whose result is discarded is a validator that only pretends to
    // coerce.
    const { onError } = collector();
    const events = createEvents<AppEvents>({
      onError,
      validate: {
        'post.published': raw => ({ id: Number((raw as { id: unknown }).id) }),
      },
    });
    const seen: unknown[] = [];
    events.on('post.published', p => void seen.push(p));

    // the payload arrives from a broker as a string id; the map says number.
    await events.emitAndWait('post.published', { id: '7' } as unknown as { readonly id: number });

    expect(seen).toEqual([{ id: 7 }]);
  });

  it.fails('validate is skipped when absent', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §2: `validate` is optional and PER EVENT, unlike ../subscriptions/SPEC.md's total
    // `TopicValidators<M>`. So an event with no entry passes through untouched — asserted with
    // `toBe`, on identity, because `toEqual` would also pass for a defensive clone and the spec's
    // reasoning ("validating it would be checking our own work") means there should not be one.
    const { onError } = collector();
    const events = createEvents<AppEvents>({
      onError,
      validate: { 'post.published': raw => raw as { readonly id: number } },
    });
    const seen: unknown[] = [];
    events.on('user.deleted', p => void seen.push(p));

    const payload = { userId: 'u1' };
    await events.emitAndWait('user.deleted', payload);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(payload);
  });

  it.fails('a rejected payload becomes an EventFailure rather than a throw', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §9 item 11's second clause, verbatim. A validator that throws must not reject
    // `emitAndWait` — §3's rule applies to the whole emit, not only to handlers — and no handler
    // may run on a payload that failed validation. Both halves are asserted, because an
    // implementation that reported the failure and still called the handler would satisfy the
    // first alone.
    const { errors, onError } = collector();
    const events = createEvents<AppEvents>({
      onError,
      validate: {
        'post.published': () => {
          throw new Error('id must be a number');
        },
      },
    });
    const ran: string[] = [];
    events.on('post.published', () => void ran.push('handler'));

    const report = await events.emitAndWait('post.published', { id: 1 });

    expect(ran).toEqual([]);
    expect(report.delivered).toBe(0);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.event).toBe('post.published');
    expect(errors).toHaveLength(1);
  });
});

// ===========================================================================
// §8 — a provider, not a module-level singleton
// ===========================================================================
describe('events: in-process and per-instance (#593, SPEC §8)', () => {
  it.fails('two Events instances in one process do not share handlers', async () => {
    // actual today: Error: unimplemented: createEvents.
    //
    // SPEC §8: "It is a provider on the container, not a module-level singleton, so two apps in one
    // process do not share handlers — … it is what makes #593's assertions independent of test
    // order." The spec names this file's own reliability as the reason, so it is asserted here
    // rather than assumed: a module-level registry would make every test above order-dependent and
    // the suite would rot from the inside.
    const { onError } = collector();
    const first = createEvents<AppEvents>({ onError });
    const second = createEvents<AppEvents>({ onError });
    const ran: string[] = [];

    first.on('post.published', () => void ran.push('first'));

    const report = await second.emitAndWait('post.published', { id: 1 });

    expect(ran).toEqual([]);
    expect(report.delivered).toBe(0);
    expect(report.failures).toEqual([]);
  });

  it('an event map is a type alias, because an interface does not satisfy EventMap', () => {
    // The green companion, and the one repo-level correction this file makes to its own spec.
    // Verified 2026-09-04 with tsc: `interface AppEvents { 'post.published': {…} }` assigned to a
    // parameter constrained by `EventMap` is TS2344, "Index signature for type 'string' is missing
    // in type 'AppEvents'", because an implicit index signature is given to object-literal type
    // ALIASES and not to interface declarations. SPEC §2's prose and
    // docs-site/content/web-events.md both use `interface`. The compile-time proof is in
    // ./events.type-test.ts; this runtime test exists only so the finding is visible in the suite
    // output, where a reader looking for "why is my map rejected" will actually see it.
    const map: EventMap = { 'post.published': { id: 1 } };
    expect(Object.keys(map)).toEqual(['post.published']);
  });
});
