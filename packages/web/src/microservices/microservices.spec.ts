import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createApp, type App } from '../app/index.js';
import { countMetadataReads } from '../bench/index.js';
import type { Ctx, QueryValues } from '../context/index.js';
import type { Guard } from '../middleware/index.js';
import { Module } from '../modules/index.js';
import { Controller, Get } from '../routing/index.js';

// Message transports at the application boundary. Tests freeze for the epic "Microservice transports
// — a strategy layer, brokers, gRPC, and hybrid applications" (#556 / spec freeze #557). The frozen
// text is `./SPEC.md` §3.1, §5, §6, §10 and §11, and its own list of what to assert is §12.
//
// `it.fails` for the frozen claims, with the output today's code produces recorded in a comment
// above each one, captured by running it — not reasoned about. `it.fails` rather than `.skip`,
// because a skipped test is invisible in the summary line; and rather than a `declare`d stub,
// because a missing symbol fails with a `ReferenceError` that reads the same whether the feature is
// absent, misnamed or wrong. Vitest
// fails an `it.fails` whose body passes ("Expect test to fail"), so none of these can be forgotten
// on the way in.
//
// ---------------------------------------------------------------------------
// The boundary, and why there is exactly one
// ---------------------------------------------------------------------------
//
// `packages/web/src/microservices/` holds two `SPEC.md` files and no code. There is no `./index.ts`,
// no `./microservices` entry in `packages/web/package.json`, and therefore neither an exported
// function to call nor an exported type to intersect a widening with. The idiom #409 established —
// `RealType & { newField }` handed to a real function — presupposes the module exists.
//
// One real function reaches every claim asserted below: `createApp`. §10 freezes a second parameter
// on it, and §10 step 4 hands the dispatcher's own `dispatch` to `strategy.listen(dispatch)`. So a
// scripted fake strategy captures the real dispatcher and drives it, and `createMessageDispatcher`
// never has to be named. The widening is anchored to `createApp`'s real signature through
// `Parameters`/`ReturnType`: change that signature and this file stops compiling rather than quietly
// testing a shape nobody has.
//
// `createAppWithTransports` below needs no cast and no `@ts-expect-error`. A one-parameter function
// is assignable to a two-parameter function type, so the widening is an annotation, and the second
// argument is ignored at runtime — which is what makes every assertion here fail on a comparison
// rather than on a throw.
//
// What is deliberately absent: §12's items 3-7 need `@MessagePattern`/`@EventPattern` to register a
// handler at all, and items 10-13 need `createMessageClient`. Neither has a boundary today, and the
// convention forbids both `declare`ing the function and stubbing it, so those nine assertions cannot
// be written as diagnostic red tests in this slice. `./grpc/grpc.spec.ts` records the same about
// `@grpc/grpc-js`. All of them are enumerated in the tests-freeze notes rather than left implied.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// §2, §3 and §5 verbatim. Held locally because the module they belong to does not exist, so there is
// nothing to intersect with; the anchoring is done once, at `FrozenCreateApp`, against the real
// `createApp`. Every one of these aliases deletes itself in the slice that exports the real ones —
// `./microservices.type-test.ts` is what asserts the exported names have exactly these shapes, and
// it is that file, not this one, that goes red if a name lands with the wrong members.

/** §2: the three-arm settlement. `retry` always carries `afterMs`; `requeue` is nowhere. */
type FrozenSettlement =
  | { readonly kind: 'ack' }
  | { readonly kind: 'retry'; readonly afterMs: number }
  | { readonly kind: 'dead'; readonly reason: string };

/** §2: what a strategy constructs per delivery. `payload` is parsed, NOT validated. */
interface FrozenRawMessage {
  readonly pattern: string;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string | undefined;
  readonly replyTo: string | undefined;
  readonly deliveryAttempt: number;
}

/** §2.3: read by the dispatcher, not decoration. */
interface FrozenTransportCapabilities {
  readonly redelivery: boolean;
  readonly deadLetter: boolean;
  readonly requestResponse: boolean;
}

/** §2: the whole strategy interface. `listen`'s callback *returns* the settlement (§2.1). */
interface FrozenTransportStrategy {
  readonly name: string;
  readonly capabilities: FrozenTransportCapabilities;
  listen(dispatch: (message: FrozenRawMessage) => Promise<FrozenSettlement>): Promise<void>;
  send(pattern: string, payload: unknown, timeoutMs: number): Promise<unknown>;
  emit(pattern: string, payload: unknown): Promise<void>;
  close(graceMs: number): Promise<void>;
}

/** §5: three required sinks, and an `onUndeliverable` the type cannot make conditionally required. */
interface FrozenDispatcherOptions {
  readonly onUnhandled: (message: FrozenRawMessage) => void;
  readonly onInvalidPayload: (message: FrozenRawMessage, error: unknown) => void;
  readonly onHandlerError: (message: FrozenRawMessage, error: unknown) => void;
  readonly onUndeliverable?: (message: FrozenRawMessage, settlement: FrozenSettlement) => void;
  readonly maxAttempts?: number;
  readonly retryAfterMs?: (attempt: number) => number;
}

/** §3.1: the named structural portion `Ctx` and `MessageContext` share, with no `extends` on either. */
type FrozenWithHeaders = { readonly headers: Readonly<Record<string, string>> };

/** §3: a sibling of `Ctx`, not a subtype. `correlationId` is `string` here (§3, generated when absent). */
interface FrozenMessageContext<T> {
  readonly kind: 'message';
  readonly pattern: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string;
  readonly deliveryAttempt: number;
  readonly transport: string;
}

/** §3.3: a separate interface, because `Guard.canActivate` takes a `Ctx` and a message is not one. */
interface FrozenMessageGuard {
  canActivate(ctx: FrozenMessageContext<unknown>): boolean | Promise<boolean>;
}

/** §10: the second parameter `createApp` gains. `graceMs` defaults to 5_000. */
interface FrozenAppOptions {
  readonly transports?: readonly FrozenTransportStrategy[];
  readonly dispatcher?: FrozenDispatcherOptions;
  readonly graceMs?: number;
}

/**
 * The real `createApp`, over the second parameter §10 freezes.
 *
 * boundary: both the module class and the return type are read off `typeof createApp`, so this
 * alias tracks the real signature instead of restating it. The assignment needs no cast — a
 * one-parameter function satisfies a two-parameter function type — and at runtime `createApp`
 * simply drops the second argument, which is what every `it.fails` below records.
 */
type FrozenCreateApp = (rootModule: Parameters<typeof createApp>[0], opts?: FrozenAppOptions) => App;

const createAppWithTransports: FrozenCreateApp = createApp;

// ---------------------------------------------------------------------------
// The scripted fake strategy
// ---------------------------------------------------------------------------
//
// §11: "The in-repository demonstration is the in-memory strategy #558 needs anyway — capabilities
// all `true`, a `Map` of queues, a settable clock". No sockets, no servers and no timers: the tests
// that would need a clock (§12.7 `retryAfterMs`, §12.10 the request timeout) are in the blocked set,
// so nothing here reads one. Everything is recorded into a shared array, because the frozen claims
// are about the *order* of events and two plausible implementations agree on the final state.

interface Fake extends FrozenTransportStrategy {
  /** The real dispatcher, as handed to `listen`. `undefined` until `listen` is called. */
  dispatch: ((message: FrozenRawMessage) => Promise<FrozenSettlement>) | undefined;
}

const ALL_TRUE: FrozenTransportCapabilities = { redelivery: true, deadLetter: true, requestResponse: true };
const NO_REDELIVERY: FrozenTransportCapabilities = { redelivery: false, deadLetter: false, requestResponse: true };

function fake(
  name: string,
  log: string[],
  capabilities: FrozenTransportCapabilities = ALL_TRUE,
  onListen: 'resolve' | 'reject' = 'resolve',
): Fake {
  const strategy: Fake = {
    name,
    capabilities,
    dispatch: undefined,
    listen(dispatch) {
      log.push(`listen:${name}`);
      strategy.dispatch = dispatch;
      return onListen === 'reject' ? Promise.reject(new Error(`${name} refused the connection`)) : Promise.resolve();
    },
    send: () => Promise.resolve(undefined),
    emit: () => Promise.resolve(),
    close(graceMs) {
      log.push(`close:${name}:${graceMs}`);
      return Promise.resolve();
    },
  };
  return strategy;
}

/** A delivery, as a strategy would construct one (§2). */
function delivery(pattern: string, payload: unknown = { id: 1 }, deliveryAttempt = 1): FrozenRawMessage {
  return { pattern, payload, headers: {}, correlationId: undefined, replyTo: undefined, deliveryAttempt };
}

/** The three required sinks, each recording into `log` (§5). */
function sinks(log: string[]): FrozenDispatcherOptions {
  return {
    onUnhandled: message => log.push(`onUnhandled:${message.pattern}`),
    onInvalidPayload: message => log.push(`onInvalidPayload:${message.pattern}`),
    onHandlerError: message => log.push(`onHandlerError:${message.pattern}`),
  };
}

/**
 * Turn a settled or rejected `init()` into a comparable string.
 *
 * boundary: an uncaught rejection here would print whichever internal threw instead of the
 * function's answer, and the claim in every case below is "`init` rejects", not "`init` throws this
 * text". §5 and §10 freeze that it rejects and say nothing about the message, so asserting a message
 * would be inventing a golden nobody promised.
 */
async function outcomeOf(app: App): Promise<'init resolved' | 'init rejected'> {
  return app.init().then(
    () => 'init resolved' as const,
    () => 'init rejected' as const,
  );
}

describe('the hybrid lifecycle (frozen: microservices/SPEC.md 10)', () => {
  // §12.16. §10's startup order is four steps and step 4 is last for a stated reason: "a message
  // must never arrive before the bootstrap hooks have run". Asserted as the recorded array rather
  // than as "listen was called", because an implementation that opens the transport inside
  // `createApp` — before any hook — passes the weaker assertion and loses the property.
  //
  // actual today (`createApp` takes one parameter, so the options object is dropped on the floor):
  //   [ 'onModuleInit:Consumer', 'onApplicationBootstrap:Consumer' ]
  it.fails('listen is called after onApplicationBootstrap', async () => {
    const log: string[] = [];
    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        return 'ok';
      }
      onModuleInit(): void {
        log.push('onModuleInit:Consumer');
      }
      onApplicationBootstrap(): void {
        log.push('onApplicationBootstrap:Consumer');
      }
    }
    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createAppWithTransports(Root, { transports: [fake('a', log)], dispatcher: sinks(log) });
    await app.init();
    expect(log).toEqual(['onModuleInit:Consumer', 'onApplicationBootstrap:Consumer', 'listen:a']);
  });

  // §12.17, both halves in one test, because they are one requirement: "Before rejecting, `init()`
  // must `close(graceMs)` the transports it already opened. Otherwise a crash-looping pod leaks one
  // broker connection per attempt, and the broker's connection limit becomes the outage." An
  // implementation that rejects and leaks passes the first half.
  //
  // actual today:
  //   { outcome: 'init resolved', log: [] }
  it.fails('a rejecting listen rejects init and closes the transports already opened', async () => {
    const log: string[] = [];
    @Module({ controllers: [] })
    class Root {}

    const app = createAppWithTransports(Root, {
      transports: [fake('a', log), fake('b', log, ALL_TRUE, 'reject')],
      dispatcher: sinks(log),
    });
    expect({ outcome: await outcomeOf(app), log }).toEqual({
      outcome: 'init rejected',
      // 'a' opened, 'b' refused, so 'a' is the one that has to be closed — and with the app's grace
      // bound, since §2.5 gives `close` no default.
      log: ['listen:a', 'listen:b', 'close:a:5000'],
    });
  });

  // §12.18, and it carries three frozen facts that only a recorded array can hold apart: transports
  // close before the hooks run (§10, "a handler whose repository has already been disposed is worse
  // than a message that waits for the next process"), they close in *reverse* declaration order, and
  // the bound passed to `close` is the app's `graceMs`, whose default §10 fixes at 5_000. Two
  // plausible implementations — one closing in declaration order, one running the hooks first —
  // agree on the final state and differ only here.
  //
  // actual today:
  //   [ 'onShutdown:Consumer' ]
  it.fails('dispose closes transports before running shutdown hooks', async () => {
    const log: string[] = [];
    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        return 'ok';
      }
      onShutdown(): void {
        log.push('onShutdown:Consumer');
      }
    }
    @Module({ controllers: [Consumer] })
    class Root {}

    const app = createAppWithTransports(Root, {
      transports: [fake('a', log), fake('b', log)],
      dispatcher: sinks(log),
    });
    await app.init();
    log.length = 0;
    await app[Symbol.asyncDispose]();
    expect(log).toEqual(['close:b:5000', 'close:a:5000', 'onShutdown:Consumer']);
  });

  // §2.5: `close(graceMs)` takes a required argument, and §10 says `AppOptions.graceMs` is what is
  // "passed to close()". A separate test from the one above because "the default is 5_000" and "the
  // caller's number is the one used" are two different bugs, and an implementation that hard-codes
  // the default passes the first.
  //
  // actual today:
  //   []
  it.fails('the app grace bound is the number passed to every close', async () => {
    const log: string[] = [];
    @Module({ controllers: [] })
    class Root {}

    const app = createAppWithTransports(Root, {
      transports: [fake('a', log), fake('b', log)],
      dispatcher: sinks(log),
      graceMs: 250,
    });
    await app.init();
    log.length = 0;
    await app[Symbol.asyncDispose]();
    expect(log).toEqual(['close:b:250', 'close:a:250']);
  });

  // Green, and not padding: §10 says "`App` gains **nothing**. There is no `connectMicroservice` and
  // no `startAllMicroservices`, because `init()` is already the one place startup happens and a
  // second entry point would let an application forget it". The tempting way to make the four red
  // tests above pass is to add a start method and call it from the test — this is what refuses that,
  // and it is asserted as the whole key set rather than as two `not.toHaveProperty` calls so any
  // added method is caught too. `lazy` is #601's data property; `Symbol.asyncDispose` is a symbol
  // key and so is not in `Object.keys`.
  it('App gains no connectMicroservice and no startAllMicroservices', () => {
    @Module({ controllers: [] })
    class Root {}
    const app = createAppWithTransports(Root, { transports: [], dispatcher: sinks([]) });
    expect(Object.keys(app).toSorted()).toEqual(['container', 'fetch', 'handle', 'init', 'lazy']);
    expect(typeof app[Symbol.asyncDispose]).toBe('function');
  });

  // #556 DoD 7 and the issue's own test plan: "serves HTTP and a transport from one process sharing
  // one container — assert a singleton is the same instance in both". The container half is green
  // today and asserted anyway, because the shortcut for making the transport half work is a second
  // container built for the message side, and that shortcut passes every other test in this file.
  //
  // actual today:
  //   { http: 'ok', sameInstance: true, listenCalled: false }
  it.fails('serves HTTP and a transport from one process sharing one container', async () => {
    const log: string[] = [];
    const seen: object[] = [];
    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        seen.push(this);
        return 'ok';
      }
    }
    @Module({ controllers: [Consumer] })
    class Root {}

    const transport = fake('a', log);
    const app = createAppWithTransports(Root, { transports: [transport], dispatcher: sinks(log) });
    await app.init();
    const response = await app.handle({ method: 'GET', path: '/orders', headers: {} });
    expect({
      http: response.status === 200 ? 'ok' : `status ${response.status}`,
      // One instance, reached twice: `compileModule` builds each controller once, so the object the
      // HTTP path invoked is the object the message path has to reach.
      sameInstance: seen.length === 1 && seen[0] === seen.at(-1),
      listenCalled: transport.dispatch !== undefined,
    }).toEqual({ http: 'ok', sameInstance: true, listenCalled: true });
  });
});

describe('the dispatcher and its sinks (frozen: microservices/SPEC.md 5, 6)', () => {
  // §12.8, the row in §6's table that "would otherwise loop forever": a subject with no handler is
  // `onUnhandled` plus `{ kind: 'ack' }` — acknowledged, "because a message nobody wants must not be
  // redelivered forever". This is the one settlement reachable with no handler registered, which is
  // why it is the only row of §6 asserted here; the rest need `@MessagePattern`.
  //
  // The settlement is stringified rather than compared as an object so that the "listen was never
  // called" case reads as itself in the diff instead of as `undefined`.
  //
  // actual today:
  //   { settlement: 'listen was never called', sinks: [] }
  it.fails('an unknown pattern acks and reaches onUnhandled', async () => {
    const log: string[] = [];
    @Module({ controllers: [] })
    class Root {}

    const transport = fake('a', []);
    const app = createAppWithTransports(Root, { transports: [transport], dispatcher: sinks(log) });
    await app.init();
    const dispatch = transport.dispatch;
    const settlement =
      dispatch === undefined ? 'listen was never called' : JSON.stringify(await dispatch(delivery('orders.nobody')));
    expect({ settlement, sinks: log }).toEqual({
      settlement: '{"kind":"ack"}',
      sinks: ['onUnhandled:orders.nobody'],
    });
  });

  // §12.9. §5: `onUndeliverable` "is required — despite being spelled optional in the type" —
  // whenever `capabilities.redelivery` or `.deadLetter` is `false`, and the check happens at
  // construction "rather than at the first dropped message", because "a misconfiguration that only
  // surfaces the first time something fails is a misconfiguration that surfaces in production".
  //
  // `listenCalled: false` is the half that says *when*: §10 builds the dispatcher at step 3 and
  // calls `listen` at step 4, so a construction-time throw is one that happens before the transport
  // is ever opened. An implementation that validates inside the first dispatch gives `true` here.
  // It matches today's value too, which is why the pair is asserted rather than the outcome alone.
  //
  // No message is asserted: §5 freezes that construction throws and not what it says, so a golden
  // string here would be one this file invented.
  //
  // actual today:
  //   { outcome: 'init resolved', listenCalled: false }
  it.fails('constructing a dispatcher over a strategy with redelivery false and no onUndeliverable throws', async () => {
    const log: string[] = [];
    @Module({ controllers: [] })
    class Root {}

    const transport = fake('redis-pubsub', log, NO_REDELIVERY);
    const app = createAppWithTransports(Root, { transports: [transport], dispatcher: sinks(log) });
    expect({ outcome: await outcomeOf(app), listenCalled: transport.dispatch !== undefined }).toEqual({
      outcome: 'init rejected',
      listenCalled: false,
    });
  });

  // §12.19, which pins #556's §1 cost-model constraint: "message dispatch resolves the handler
  // through a structure built at startup, not by scanning patterns per message". `countMetadataReads`
  // (`../bench/index.ts`) is the project's existing probe for exactly this question — it is what
  // proves route resolution does not re-read metadata per request — so the pattern map gets the same
  // instrument rather than a new one.
  //
  // `readsDuringDispatch: 0` is true today as well, and on its own it would be a green test for the
  // wrong reason: nothing reads metadata during a dispatch because no dispatch happens. The two
  // numbers are asserted together so the assertion cannot be satisfied by the feature's absence.
  //
  // actual today:
  //   { readsDuringDispatch: 0, dispatched: 0, listenCalled: false }
  it.fails('the pattern map is built once', async () => {
    const log: string[] = [];
    @Controller('/orders')
    class Consumer {
      @Get('/')
      list(): string {
        return 'ok';
      }
    }
    @Module({ controllers: [Consumer] })
    class Root {}

    const counter = countMetadataReads(Consumer);
    const transport = fake('a', log);
    const app = createAppWithTransports(Root, { transports: [transport], dispatcher: sinks(log) });
    await app.init();
    const afterInit = counter.count();
    const dispatch = transport.dispatch;
    let dispatched = 0;
    if (dispatch !== undefined) {
      for (let i = 0; i < 5; i += 1) {
        await dispatch(delivery(`orders.n${i}`));
        dispatched += 1;
      }
    }
    const readsDuringDispatch = counter.count() - afterInit;
    counter.restore();
    expect({ readsDuringDispatch, dispatched, listenCalled: dispatch !== undefined }).toEqual({
      readsDuringDispatch: 0,
      dispatched: 5,
      listenCalled: true,
    });
  });
});

describe('the shared authorisation function (frozen: microservices/SPEC.md 3.1, 3.3)', () => {
  // §12.14, the amended #556 DoD 2. Green, and it is the assertion that stops the red tests above
  // being made to pass the cheap way: the obvious route to "one guard serves both" is to give
  // `MessageContext` a `method` and a `path` and reuse `Guard`, which §1 calls a security hole ("an
  // authorisation check that was protecting a route stops protecting anything and nothing fails").
  // What that shortcut cannot do is keep this test passing *and* keep
  // `./microservices.type-test.ts`'s two non-assignability assertions passing.
  //
  // `Guard` is imported from `../middleware/index.js` rather than restated, so widening
  // `Guard.canActivate` breaks this file at compile time.
  it('one authorisation function written against WithHeaders is callable from both a Guard and a MessageGuard', async () => {
    // The function #556 actually wanted to share. It names neither context type.
    const requiresApiKey = (ctx: FrozenWithHeaders): boolean => ctx.headers['x-api-key'] === 'secret';

    const httpGuard: Guard = { canActivate: ctx => requiresApiKey(ctx) };
    const messageGuard: FrozenMessageGuard = { canActivate: ctx => requiresApiKey(ctx) };

    const httpCtx: Ctx<Record<string, string>, unknown, QueryValues> = {
      params: {},
      body: undefined,
      query: {},
      headers: { 'x-api-key': 'secret' },
      method: 'GET',
      path: '/orders',
    };
    const messageCtx: FrozenMessageContext<unknown> = {
      kind: 'message',
      pattern: 'orders.get',
      payload: { id: 1 },
      headers: { 'x-api-key': 'secret' },
      correlationId: 'c1',
      deliveryAttempt: 1,
      transport: 'a',
    };

    expect(await httpGuard.canActivate(httpCtx)).toBe(true);
    expect(await messageGuard.canActivate(messageCtx)).toBe(true);
    // And it refuses both, so the shared logic is genuinely being consulted in each.
    expect(await httpGuard.canActivate({ ...httpCtx, headers: {} })).toBe(false);
    expect(await messageGuard.canActivate({ ...messageCtx, headers: {} })).toBe(false);
  });
});

describe('the custom-transport seam (frozen: microservices/SPEC.md 11)', () => {
  // #556 DoD 6 — "demonstrated by a strategy written entirely against public API" — plus the issue's
  // own test plan, whose title is kept verbatim because it is the one a later `mapping.mjs` row will
  // cite. §11 says the demonstration *is* the in-memory strategy this file already uses, which
  // reduces the claim to two checkable facts: the six names in §11's table are reachable from a
  // published subpath, and a strategy holding nothing but them can be dispatched to.
  //
  // The subpath is checked as text in `packages/web/package.json` rather than by importing it,
  // because an import of a subpath that is not in the `exports` map fails at collection and takes
  // the whole file with it. `verify:exports` imports every subpath under plain node, so the entry
  // and the module have to land together.
  //
  // The dispatch half is thin on purpose and cannot be thickened yet: with no `@MessagePattern`
  // there is no handler to reach, so `ack` on an unhandled pattern is the only settlement a
  // third-party strategy can observe. Recorded in the tests-freeze notes as an assertion #562 has to
  // strengthen rather than delete.
  //
  // actual today:
  //   { subpath: 'absent', settlements: [] }
  it.fails('a third-party strategy written only against public exports dispatches messages', async () => {
    const pkg = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    @Module({ controllers: [] })
    class Root {}

    const transport = fake('third-party', []);
    const app = createAppWithTransports(Root, { transports: [transport], dispatcher: sinks([]) });
    await app.init();
    const dispatch = transport.dispatch;
    const settlements: string[] = [];
    if (dispatch !== undefined) settlements.push((await dispatch(delivery('third.party'))).kind);
    expect({
      subpath: pkg.includes('"./microservices":') ? 'exported' : 'absent',
      settlements,
    }).toEqual({ subpath: 'exported', settlements: ['ack'] });
  });
});
