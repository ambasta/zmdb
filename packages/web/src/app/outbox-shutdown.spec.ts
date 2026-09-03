// Tests freeze (#593) for the one assertion in packages/query-compiler/src/outbox/SPEC.md §5 that
// cannot be made from either the outbox package or the events package: that a dispatcher registered
// on an application is actually drained when the application shuts down.
//
// §5 promises `onShutdown()` "stops claiming, waits for the in-flight batch, and does not wait for
// the lease". ../../../repository/src/outbox/outbox.spec.ts asserts that promise against the
// dispatcher object. This file asserts the other half — that something calls it — because a
// dispatcher whose `onShutdown` is correct and never invoked loses its in-flight batch on every
// deploy, and that failure is invisible to both suites above.
//
// WHAT IT FOUND, and why half this file is green rather than red. `createApp` (./index.ts:38-39)
// drives `runInit(controllers)` and `runShutdown(controllers)` — CONTROLLERS ONLY. A provider's
// `onModuleInit` and `onShutdown` are never called, even for a `useValue` provider that is already
// constructed and resolvable. Verified 2026-09-04 by running a module with one lifecycle-implementing
// controller and one lifecycle-implementing provider through `createApp().init()` and
// `Symbol.asyncDispose`:
//
//   LOG=["controller:init","controller:shutdown"]
//   RESOLVED=true          // the provider instance was there the whole time
//
// So the green tests below pin that as today's shipped behaviour, and the `it.fails` tests state
// what §5 needs. The natural home for a dispatcher is a provider — SPEC §6 of ../cqrs/SPEC.md makes
// the same point about the command bus, "registered like any other provider" — and a provider is
// exactly what never gets drained.
//
// THE IDIOM: this file has no missing imports at all. `createApp` and `@Module` both exist, and the
// dispatcher is stood in for by a hand-written object with the frozen `OutboxDispatcher` shape, so
// every test here is executable today. That is deliberate: the gap is in code that already ships,
// so asserting it needs no stub, and an `it.fails` here means "the framework does not do this yet"
// rather than "this module is unwritten".
import { describe, expect, it } from 'vitest';

import { createToken } from '../di/index.js';
import { Module } from '../modules/index.js';
import { createApp } from './index.js';

// ---------------------------------------------------------------------------
// the dispatcher's frozen shape (outbox SPEC §5), hand-written
// ---------------------------------------------------------------------------
interface OutboxDispatcher {
  runOnce(): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }>;
  start(): void;
  onShutdown(): Promise<void>;
}

/**
 * A dispatcher that records its own lifecycle. It implements `OnModuleInit` and `OnShutdown`
 * structurally, which is how ../lifecycle.ts detects them (`'onShutdown' in x`, no reflection), so
 * if `createApp` ever drives providers this object needs no change to be driven.
 */
class RecordingDispatcher implements OutboxDispatcher {
  started = 0;
  drained = 0;
  claiming = false;

  onModuleInit(): void {
    this.start();
  }

  onShutdown(): Promise<void> {
    this.drained += 1;
    this.claiming = false;
    return Promise.resolve();
  }

  start(): void {
    this.started += 1;
    this.claiming = true;
  }

  runOnce(): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }> {
    return Promise.resolve({ claimed: 0, delivered: 0, failed: 0 });
  }
}

// A `Token<T>` is an object with a `description`, not a string (../di/index.ts:10-13). A bare string
// happens to WORK at runtime — the container is a `Map` and any key resolves — but it is TS2322,
// "Type 'string' is not assignable to type 'Token<unknown>'" (verified 2026-09-04), and the phantom
// `__type` is what makes `resolve` return the dispatcher rather than `unknown`.
const DISPATCHER = createToken<RecordingDispatcher>('OUTBOX_DISPATCHER');
const UNUSED = createToken<RecordingDispatcher>('OUTBOX_DISPATCHER_UNUSED');

// ===========================================================================
// the gap
// ===========================================================================
describe('outbox on an app: a dispatcher provider is not drained (#593, outbox SPEC §5)', () => {
  it('today: a provider that implements onShutdown is never called', async () => {
    // Today's shipped behaviour, pinned so the `it.fails` below cannot be read as a mystery.
    // `createApp` passes only `controllers` to `runInit`/`runShutdown` (./index.ts:38-39), and a
    // provider is not a controller. Recorded actual (2026-09-04): started 0, drained 0, while the
    // instance itself resolves fine from the container.
    const dispatcher = new RecordingDispatcher();

    @Module({ providers: [{ token: DISPATCHER, useValue: dispatcher }] })
    class OutboxModule {}

    const app = createApp(OutboxModule);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(dispatcher.started).toBe(0);
    expect(dispatcher.drained).toBe(0);
    // ...and it was reachable the entire time, so nothing was lazy or missing.
    expect(app.container.resolve(DISPATCHER)).toBe(dispatcher);
  });

  it('today: the same hooks on a controller ARE driven', async () => {
    // The control. Same hooks, same detection, different list — which is what proves the finding
    // above is about the registration and not about the structural detection in ../lifecycle.ts.
    //
    // The instance is observed through a shared log rather than through the container, because
    // `compileModule` does NOT register controllers as providers: `app.container.resolve(TheClass)`
    // throws `UnresolvedTokenError: @zmdb/web: no provider registered for token "undefined"` from
    // ../di/index.ts:135 (verified 2026-09-04 — the token description is `undefined` because a
    // class is not a symbol token). Worth recording: `createApp` gives a caller no handle on a
    // controller instance at all, which is a second reason a dispatcher does not belong in that list.
    const log: string[] = [];

    class ControllerDispatcher {
      onModuleInit(): void {
        log.push('start');
      }
      onShutdown(): void {
        log.push('drain');
      }
    }

    @Module({ controllers: [ControllerDispatcher] })
    class OutboxModule {}

    const app = createApp(OutboxModule);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(log).toEqual(['start', 'drain']);
  });

  it.fails('a dispatcher registered as a provider is started on init and drained on dispose', async () => {
    // actual today: AssertionError: expected +0 to be 1 // Object.is equality — the provider is never
    // driven; see the green test above.
    //
    // What outbox SPEC §5 needs. The dispatcher belongs on the container as a provider — it is a
    // value with a driver and a publish function, it is injected into whatever writes outbox rows,
    // and ../cqrs/SPEC.md §6 makes the identical argument for the command bus. Registering it as a
    // controller to get a lifecycle would put it in the router's registration loop
    // (./index.ts:29-31), which is wrong for an object with no routes.
    //
    // Landing this means `createApp` driving provider instances too. That is a change to
    // ./SPEC.md's lifecycle contract and is NOT in #593's scope — this test is the freeze's
    // statement of the prerequisite, and it should stay `it.fails` until that spec change is made.
    // See NOTES.md.
    const dispatcher = new RecordingDispatcher();

    @Module({ providers: [{ token: DISPATCHER, useValue: dispatcher }] })
    class OutboxModule {}

    const app = createApp(OutboxModule);
    await app.init();
    expect(dispatcher.started).toBe(1);
    expect(dispatcher.claiming).toBe(true);

    await app[Symbol.asyncDispose]();
    expect(dispatcher.drained).toBe(1);
    expect(dispatcher.claiming).toBe(false);
  });

  it.fails('a lazily-constructed dispatcher provider is drained only if it was built', async () => {
    // actual today: AssertionError: expected +0 to be 1 // Object.is equality.
    //
    // The half that makes the change above safe to specify, and the reason it is not simply "drain
    // everything": a `useFactory` provider that nobody resolved was never constructed, so there is
    // nothing to drain and forcing its construction during SHUTDOWN would start a dispatcher in
    // order to stop it. ../lifecycle.ts:48-53 already tolerates `undefined` entries — `runShutdown`
    // takes `readonly (object | undefined)[]` — which is the signature a provider walk needs and
    // which the controller walk never uses. So the contract this asserts is: drain the instances the
    // container actually built, in reverse construction order, and skip the rest.
    const built: RecordingDispatcher[] = [];

    @Module({
      providers: [
        {
          token: DISPATCHER,
          useFactory: () => {
            const d = new RecordingDispatcher();
            built.push(d);
            return d;
          },
        },
        { token: UNUSED, useFactory: () => new RecordingDispatcher() },
      ],
    })
    class OutboxModule {}

    const app = createApp(OutboxModule);
    await app.init();
    const resolved = app.container.resolve(DISPATCHER);
    await app[Symbol.asyncDispose]();

    expect(built).toHaveLength(1);
    expect(resolved.drained).toBe(1);
  });

  it.fails('shutdown drains a dispatcher before the driver it depends on', async () => {
    // actual today: AssertionError: expected [] to deeply equal [ 'dispatcher', 'driver' ].
    //
    // ../lifecycle.ts:47 already documents the ordering rule — "`onShutdown` in reverse construction
    // order, so a dependent tears down before what it depends on" — and it is exactly the rule the
    // outbox needs: a dispatcher whose driver is closed underneath it fails its in-flight batch's
    // marks, which outbox SPEC §8 then turns into duplicate deliveries on the next process. The
    // ordering is asserted here because it is the property that makes "waits for the in-flight
    // batch" achievable at all.
    const order: string[] = [];

    class Driver {
      onShutdown(): void {
        order.push('driver');
      }
    }
    class Dispatcher {
      onShutdown(): void {
        order.push('dispatcher');
      }
    }
    const driver = new Driver();
    const dispatcher = new Dispatcher();
    const DRIVER = createToken<Driver>('OUTBOX_DRIVER');
    const OWNER = createToken<Dispatcher>('OUTBOX_DISPATCHER_OWNER');

    @Module({
      providers: [
        { token: DRIVER, useValue: driver },
        { token: OWNER, useValue: dispatcher },
      ],
    })
    class OutboxModule {}

    const app = createApp(OutboxModule);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(order).toEqual(['dispatcher', 'driver']);
  });

  it('await using disposes the app, which is the path a deployment actually takes', async () => {
    // Green, and it is here so the tests above are read as a gap in coverage of the REAL shutdown
    // path rather than as a quibble about a method nobody calls. `App extends AsyncDisposable`
    // (./index.ts:14), so `await using app = createApp(…)` is the documented shape, and it reaches
    // the same `runShutdown` the explicit dispose above does.
    const log: string[] = [];

    class RouteFreeController {
      onShutdown(): void {
        log.push('shutdown');
      }
    }

    @Module({ controllers: [RouteFreeController] })
    class OutboxModule {}

    {
      await using app = createApp(OutboxModule);
      await app.init();
      expect(log).toEqual([]);
    }

    expect(log).toEqual(['shutdown']);
  });
});
