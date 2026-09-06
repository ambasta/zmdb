import { createToken } from '@zmdb/app/di';
import { Module } from '@zmdb/app/modules';
// Application-level coverage for packages/query-compiler/src/outbox/SPEC.md §5: a dispatcher
// registered as a provider participates in startup and graceful shutdown.
//
// §5 promises `onShutdown()` "stops claiming, waits for the in-flight batch, and does not wait for
// the lease". ../../repository/src/outbox/outbox.spec.ts asserts that promise against the
// dispatcher object. This file asserts the other half — that something calls it — because a
// dispatcher whose `onShutdown` is correct and never invoked loses its in-flight batch on every
// deploy, and that failure is invisible to both suites above.
//
// The lifecycle ledger records value providers immediately and factory providers only after their
// factory returns. That distinction prevents shutdown from constructing an unused dispatcher just
// to stop it, while still recording dependencies before the object whose factory resolved them.
import { describe, expect, it } from 'vitest';

import { createApplication } from './index.js';

// ---------------------------------------------------------------------------
// the dispatcher's frozen shape (outbox SPEC §5), hand-written
// ---------------------------------------------------------------------------
interface OutboxDispatcher {
  runOnce(): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }>;
  start(): void;
  onModuleInit(): void;
  onShutdown(): Promise<void>;
}

/**
 * A dispatcher that records its own lifecycle. It implements `OnModuleInit` and `OnShutdown`
 * structurally, which is how ./lifecycle.ts detects them (`'onShutdown' in x`, no reflection), so
 * if `createApplication` ever drives providers this object needs no change to be driven.
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

// A `Token<T>` is an object with a `description`, not a string (./di/index.ts:10-13). A bare string
// happens to WORK at runtime — the container is a `Map` and any key resolves — but it is TS2322,
// "Type 'string' is not assignable to type 'Token<unknown>'" (verified 2026-09-04), and the phantom
// `__type` is what makes `resolve` return the dispatcher rather than `unknown`.
const DISPATCHER = createToken<RecordingDispatcher>('OUTBOX_DISPATCHER');
const UNUSED = createToken<RecordingDispatcher>('OUTBOX_DISPATCHER_UNUSED');

describe('outbox on an app: dispatcher provider lifecycle (#593, outbox SPEC §5)', () => {
  it('a value provider participates in init and shutdown without losing its container binding', async () => {
    const dispatcher = new RecordingDispatcher();

    @Module({ providers: [{ token: DISPATCHER, useValue: dispatcher }] })
    class OutboxModule {}

    const app = createApplication(OutboxModule);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(dispatcher.started).toBe(1);
    expect(dispatcher.drained).toBe(1);
    expect(app.container.resolve(DISPATCHER)).toBe(dispatcher);
  });

  it('the same hooks on a controller remain driven', async () => {
    // The instance is observed through a shared log rather than through the container, because
    // `compileModule` does NOT register controllers as providers: `app.container.resolve(TheClass)`
    // throws `UnresolvedTokenError: @zmdb/app: no provider registered for token "undefined"` from
    // ./di/index.ts:152 (verified 2026-09-06 — the token description is `undefined` because a
    // class is not a symbol token). Worth recording: `createApplication` gives a caller no handle on a
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

    const app = createApplication(OutboxModule);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(log).toEqual(['start', 'drain']);
  });

  it('a dispatcher registered as a provider is started on init and drained on dispose', async () => {
    const dispatcher = new RecordingDispatcher();

    @Module({ providers: [{ token: DISPATCHER, useValue: dispatcher }] })
    class OutboxModule {}

    const app = createApplication(OutboxModule);
    await app.init();
    expect(dispatcher.started).toBe(1);
    expect(dispatcher.claiming).toBe(true);

    await app[Symbol.asyncDispose]();
    expect(dispatcher.drained).toBe(1);
    expect(dispatcher.claiming).toBe(false);
  });

  it('a lazily-constructed dispatcher provider is drained only if it was built', async () => {
    // The half that makes provider lifecycle safe, and the reason it is not simply "drain
    // everything": a `useFactory` provider that nobody resolved was never constructed, so there is
    // nothing to drain and forcing its construction during SHUTDOWN would start a dispatcher in
    // order to stop it. A provider first resolved after `app.init()` did not exist for init, but it
    // joins the construction ledger and is still drained.
    const built: RecordingDispatcher[] = [];
    let unusedBuilt = 0;

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
        {
          token: UNUSED,
          useFactory: () => {
            unusedBuilt += 1;
            return new RecordingDispatcher();
          },
        },
      ],
    })
    class OutboxModule {}

    const app = createApplication(OutboxModule);
    await app.init();
    const resolved = app.container.resolve(DISPATCHER);
    await app[Symbol.asyncDispose]();

    expect(built).toHaveLength(1);
    expect(unusedBuilt).toBe(0);
    expect(resolved.started).toBe(0);
    expect(resolved.drained).toBe(1);
  });

  it('shutdown drains a dispatcher before the driver it depends on', async () => {
    // ./lifecycle.ts documents the ordering rule — "`onShutdown` in reverse construction
    // order, so a dependent tears down before what it depends on" — and it is exactly the rule the
    // outbox needs: a dispatcher whose driver is closed underneath it fails its in-flight batch's
    // marks. OWNER is deliberately registered before DRIVER, so declaration order cannot make this
    // pass: resolving OWNER constructs DRIVER first, then OWNER, and shutdown reverses that order.
    const order: string[] = [];

    class Driver {
      onShutdown(): void {
        order.push('driver');
      }
    }
    class Dispatcher {
      constructor(readonly driver: Driver) {}

      onShutdown(): void {
        order.push('dispatcher');
      }
    }
    const DRIVER = createToken<Driver>('OUTBOX_DRIVER');
    const OWNER = createToken<Dispatcher>('OUTBOX_DISPATCHER_OWNER');

    @Module({
      providers: [
        { token: OWNER, useFactory: c => new Dispatcher(c.resolve(DRIVER)) },
        { token: DRIVER, useFactory: () => new Driver() },
      ],
    })
    class OutboxModule {}

    const app = createApplication(OutboxModule);
    app.container.resolve(OWNER);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(order).toEqual(['dispatcher', 'driver']);
  });

  it('await using disposes the app, which is the path a deployment actually takes', async () => {
    // Green, and it is here so the tests above are read as a gap in coverage of the REAL shutdown
    // path rather than as a quibble about a method nobody calls. `Application extends AsyncDisposable`,
    // so `await using app = createApplication(…)` is the documented shape, and it reaches
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
      await using app = createApplication(OutboxModule);
      await app.init();
      expect(log).toEqual([]);
    }

    expect(log).toEqual(['shutdown']);
  });
});
