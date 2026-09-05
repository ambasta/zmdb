import { databaseReadinessCheck, type CheckResult, type HealthChecks, type ReadinessCheck } from '@zmdb/app/health';
// Runtime acceptance tests for the liveness/readiness probes frozen by #580 and
// implemented by #581 (epic #578).
//
// THE TIMING TESTS USE FAKE TIMERS. ./SPEC.md §4's bound is `max(timeoutMs) + 50ms` and §6
// asks for a cache window; asserting either against the wall clock buys a flaky test in CI
// for no extra confidence, so the clock is `vi.useFakeTimers()` and the ordering of
// `advanceTimersByTimeAsync` against the pending promise is the assertion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Guard } from '../middleware/index.js';
import { createRouter, json, type WebResponse } from '../pipeline/index.js';
import { Controller, Get } from '../routing/index.js';
import { detailedReadyRoute, healthRoutes, type DetailedBody } from './index.js';

/** A readiness check that resolves immediately, and counts how often it ran. */
const instantCheck = (
  name: string,
  result: CheckResult,
  overrides: { readonly timeoutMs?: number; readonly cacheMs?: number } = {},
): ReadinessCheck & { readonly runs: () => number } => {
  let runs = 0;
  return {
    name,
    timeoutMs: overrides.timeoutMs ?? 1000,
    ...(overrides.cacheMs === undefined ? {} : { cacheMs: overrides.cacheMs }),
    runs: () => runs,
    run: () => {
      runs += 1;
      return Promise.resolve(result);
    },
  };
};

/** A readiness check that never resolves. §4's wedged dependency. */
const hangingCheck = (name: string, timeoutMs: number): ReadinessCheck & { readonly runs: () => number } => {
  let runs = 0;
  return {
    name,
    timeoutMs,
    runs: () => runs,
    run: () => {
      runs += 1;
      return new Promise<CheckResult>(() => {
        // Never settles. §4 is explicit that the framework abandons the promise rather than
        // cancelling the work, so there is nothing to clean up here and that is the point.
      });
    },
  };
};

/** A readiness check that resolves after `ms` on the fake clock. */
const slowCheck = (name: string, ms: number, timeoutMs: number): ReadinessCheck & { readonly runs: () => number } => {
  let runs = 0;
  return {
    name,
    timeoutMs,
    run: () => {
      runs += 1;
      return new Promise<CheckResult>(resolve => {
        setTimeout(() => resolve({ ok: true }), ms);
      });
    },
    runs: () => runs,
  };
};

function textOf(response: WebResponse): string {
  switch (response.body.kind) {
    case 'text':
      return response.body.value;
    case 'bytes':
      return new TextDecoder().decode(response.body.value);
    case 'stream':
      throw new TypeError('health responses must not stream');
  }
}

const bodyOf = (response: WebResponse): DetailedBody => JSON.parse(textOf(response)) as DetailedBody;

describe('health probes (#580 freeze of health SPEC)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The one green test in the file, and it exists because ./SPEC.md §3 makes a claim about
  // code that already ships: *"`json(value, { status: 503 })` has existed since
  // `pipeline/index.ts:129`, so nothing about the response shape above needs a framework
  // change; the module is a controller and an aggregator."* That claim is the reason #581 is
  // small, so it is worth an assertion rather than a citation.
  //
  // It also pins the exact bytes the health tests below compare against. Recorded
  // 2026-09-04 by calling `json` under `node --import scripts/ts-specifier-hook.mjs`:
  //   json({ status: 'error' }, { status: 503 }) serializes to {"status":"error"}.
  //   json({ status: 'ok' }) serializes to {"status":"ok"}.
  it('the framework already produces the exact 503 body this spec freezes', () => {
    const failing = json({ status: 'error' }, { status: 503 });
    expect(failing.status).toBe(503);
    expect(textOf(failing)).toBe('{"status":"error"}');
    expect(failing.headers['content-type']).toBe('application/json');

    const passing = json({ status: 'ok' });
    expect(passing.status).toBe(200);
    expect(textOf(passing)).toBe('{"status":"ok"}');

    // §3 chose 503 over 500 for the human and the proxy, not for the orchestrator. Assert the
    // number rather than "not 2xx", because "not 2xx" is what makes 500 look acceptable.
    expect(failing.status).not.toBe(500);
  });

  // §6.2. Asserted against the serialized string rather than a parsed object, exactly as the
  // spec asks, "so a field added later fails the test instead of passing it". `toEqual` on a
  // parsed body would accept `{"status":"error","checks":[...]}` and that is the leak §3's
  // quoted warning is about.
  it('reports ready only when every readiness check passes', async () => {
    const allPass = healthRoutes({
      readiness: [instantCheck('db', { ok: true }), instantCheck('cache', { ok: true })],
    });
    const oneFails = healthRoutes({
      readiness: [instantCheck('db', { ok: true }), instantCheck('cache', { ok: false, detail: 'no route to host' })],
    });

    const good = await allPass.ready();
    expect(good.status).toBe(200);
    expect(textOf(good)).toBe('{"status":"ok"}');

    const bad = await oneFails.ready();
    expect(bad.status).toBe(503);
    expect(textOf(bad)).toBe('{"status":"error"}');
  });

  // §2's mechanism has a runtime shadow worth asserting even though ./health.type-test.ts owns
  // the compile-time half: because every `LivenessCheck.run` is `(): boolean`, `live()` can
  // return a `WebResponse` rather than a promise. So the assertion is that the value is a
  // response and not a thenable — which is the only way a caller can observe that no check in
  // the liveness set was able to await anything.
  //
  // §1 is the reason this matters: a liveness probe that observes the database turns a
  // database blip into a restart storm across every replica at once.
  it('does not let a liveness check depend on an external service', () => {
    let ran = 0;
    const probes = healthRoutes({
      liveness: [
        {
          name: 'init-finished',
          run: () => {
            ran += 1;
            return true;
          },
        },
      ],
    });

    const response: WebResponse = probes.live();
    expect(ran).toBe(1);
    expect(response.status).toBe(200);
    expect(textOf(response)).toBe('{"status":"ok"}');
    // Not a promise. `then` being absent is what proves the whole path was synchronous, and
    // it is the property a future refactor to `async live()` would break silently.
    expect(response).not.toHaveProperty('then');
    expect(typeof (response as unknown as { then?: unknown }).then).toBe('undefined');

    const failing = healthRoutes({ liveness: [{ name: 'shutting-down', run: () => false }] });
    expect(failing.live().status).toBe(503);
    expect(textOf(failing.live())).toBe('{"status":"error"}');
  });

  // §6.3 and §6.4 together, because the timeout's `detail: 'timeout'` is only observable in
  // the detailed form and §3 forbids it from the public one.
  //
  // §4: a check that has not answered by its own deadline counts as failed, not as unknown,
  // and the other checks' real results stay intact. §6.3 additionally requires that
  // `durationMs` appears here and in no public body.
  // `Promise.all` over one hanging and one resolved promise never settles, so an
  // implementation without a per-check deadline hangs the endpoint rather than returning a
  // partial result — which is why §4's bound is a requirement and not an optimisation.
  it('counts a timed-out check as failed and names it in the detailed form only', async () => {
    vi.useFakeTimers();
    const checks: HealthChecks = {
      readiness: [hangingCheck('db', 2000), instantCheck('cache', { ok: true })],
    };

    const detailed = detailedReadyRoute(checks);
    const pending = detailed();
    await vi.advanceTimersByTimeAsync(2050);
    const response = await pending;

    expect(response.status).toBe(503);
    const body = bodyOf(response);
    expect(body.status).toBe('error');
    expect(body.checks.map(c => c.name).toSorted()).toEqual(['cache', 'db']);

    const db = body.checks.find(c => c.name === 'db');
    expect(db?.ok).toBe(false);
    expect(db?.detail).toBe('timeout');

    // The other check's real result survives: §4 refuses to collapse a partial answer into a
    // single "unknown", because the orchestrator has two states and a third only moves the
    // decision somewhere with less information.
    const cache = body.checks.find(c => c.name === 'cache');
    expect(cache?.ok).toBe(true);

    // §3: `durationMs` is a timing oracle, so it lives here and nowhere public. The public
    // probe is built from instant checks rather than reusing `checks` above: awaiting a
    // hanging check a second time would need its own clock advance, and a test that hangs
    // once the feature exists is a test that has to be rewritten to land the feature.
    expect(typeof cache?.durationMs).toBe('number');
    const publicResponse = await healthRoutes({
      readiness: [instantCheck('db', { ok: false, detail: 'timeout' }), instantCheck('cache', { ok: true })],
    }).ready();
    expect(textOf(publicResponse)).toBe('{"status":"error"}');
    expect(textOf(publicResponse)).not.toContain('durationMs');
    expect(textOf(publicResponse)).not.toContain('timeout');
    expect(textOf(publicResponse)).not.toContain('db');
  });

  // §6.5, and the assertion is deliberately built so a serial implementation fails: three
  // checks whose timeouts differ, all hanging. Concurrently the bound is
  // `max(2000, 500, 1200) + 50 = 2050ms`; serially it is `2000 + 500 + 1200 = 3700ms`.
  // Advancing the fake clock to 2050 and requiring the promise to have settled is what
  // separates the two.
  //
  // §4 is why this is the shape that matters: serial execution makes the endpoint's worst
  // case grow with every check added, "which is how a probe that was fine with two
  // dependencies starts timing out at the orchestrator with six".
  it('returns within the bounded time when every check hangs', async () => {
    vi.useFakeTimers();
    const slowest = hangingCheck('object-store', 2000);
    const fastest = hangingCheck('cache', 500);
    const middling = hangingCheck('db', 1200);
    const probes = healthRoutes({ readiness: [slowest, fastest, middling] });

    let settled = false;
    const pending = probes.ready().then(response => {
      settled = true;
      return response;
    });

    // A zero-length advance flushes the microtask queue without moving the clock. Whether
    // `run` is invoked synchronously inside `ready()` or one microtask later is #581's choice
    // and not something this freeze should pin, so the assertion is made after the flush.
    await vi.advanceTimersByTimeAsync(0);

    // All three started before any of them finished: that is the concurrency assertion, and
    // it holds even for an implementation that got the deadline right and the ordering wrong.
    expect(slowest.runs()).toBe(1);
    expect(fastest.runs()).toBe(1);
    expect(middling.runs()).toBe(1);

    await vi.advanceTimersByTimeAsync(2049);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;

    expect(settled).toBe(true);
    expect(response.status).toBe(503);
    expect(textOf(response)).toBe('{"status":"error"}');
  });

  // §6.2, §6.3 and §6.9's shared requirement, asserted as one property because it is one
  // property: nothing an unauthenticated caller can read distinguishes *which* dependency is
  // broken. §3 quotes the page's warning — `{"error":"connect ECONNREFUSED 10.0.1.14:5432"}`
  // hands an attacker your internal topology — so the assertion searches the whole public
  // body for every string a leak would carry.
  it('exposes no check detail to an unauthenticated caller', async () => {
    const probes = healthRoutes({
      readiness: [
        instantCheck('primary-postgres', { ok: false, detail: 'connect ECONNREFUSED 10.0.1.14:5432' }),
        instantCheck('redis', { ok: true }),
      ],
    });

    const response = await probes.ready();
    expect(response.status).toBe(503);
    // Two shapes and no third (§3), asserted as an exact string.
    expect(textOf(response)).toBe('{"status":"error"}');
    for (const leak of ['10.0.1.14', '5432', 'ECONNREFUSED', 'postgres', 'redis', 'checks', 'durationMs']) {
      expect(textOf(response)).not.toContain(leak);
    }
    // And the header set is the framework's own, so a probe cannot be fingerprinted by it.
    expect(response.headers['content-type']).toBe('application/json');
  });

  it('requires the normal guard chain before returning the detailed form', async () => {
    let authenticated = false;
    let runs = 0;
    const detailed = detailedReadyRoute({
      readiness: [
        {
          name: 'primary-postgres',
          timeoutMs: 1000,
          run: () => {
            runs += 1;
            return Promise.resolve({ ok: false, detail: 'db-private' });
          },
        },
      ],
    });
    const guard: Guard = { canActivate: () => authenticated };

    @Controller('/health')
    class HealthController {
      @Get('/ready/detail')
      readyDetail() {
        return detailed();
      }
    }

    const router = createRouter();
    router.register(new HealthController(), { readyDetail: { guards: [guard] } });

    const denied = await router.handle({ method: 'GET', path: '/health/ready/detail', headers: {} });
    expect(denied.status).toBe(403);
    expect(runs).toBe(0);

    authenticated = true;
    const response = await router.handle({ method: 'GET', path: '/health/ready/detail', headers: {} });
    expect(runs).toBe(1);
    expect(response).toMatchObject({ status: 503 });
    expect(textOf(response)).toContain('"detail":"db-private"');
  });

  // §6.6, both halves, and the asymmetry is the whole design (§5): caching a success delays
  // noticing a new failure by at most `cacheMs`, which the orchestrator's own
  // `periodSeconds x failureThreshold` already absorbs; caching a failure delays *recovery*
  // and nothing absorbs it.
  it('caches a successful readiness result for the specified window and does not cache a failure', async () => {
    vi.useFakeTimers();

    const passing = instantCheck('db', { ok: true }, { cacheMs: 5000 });
    const cached = healthRoutes({ readiness: [passing] });
    expect((await cached.ready()).status).toBe(200);
    expect((await cached.ready()).status).toBe(200);
    expect(passing.runs()).toBe(1);

    // One tick before the window closes it is still cached; one tick after, it is not.
    await vi.advanceTimersByTimeAsync(4999);
    expect((await cached.ready()).status).toBe(200);
    expect(passing.runs()).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect((await cached.ready()).status).toBe(200);
    expect(passing.runs()).toBe(2);

    // A failure is not cached at all, so a recovered instance is never held out of the load
    // balancer during the incident in which capacity matters most.
    const failing = instantCheck('db', { ok: false }, { cacheMs: 5000 });
    const notCached = healthRoutes({ readiness: [failing] });
    expect((await notCached.ready()).status).toBe(503);
    expect((await notCached.ready()).status).toBe(503);
    expect(failing.runs()).toBe(2);
  });

  // §6.7. Concurrent callers share one run. After a deadline a later probe retries because
  // failures are not cached; driver-level cancellation remains the only way to stop an
  // abandoned operation that ignored the signal.
  it('coalesces ten concurrent ready() calls into exactly one run', async () => {
    vi.useFakeTimers();
    const check = slowCheck('db', 100, 2000);
    const probes = healthRoutes({ readiness: [check] });

    const pending = Array.from({ length: 10 }, () => probes.ready());
    await vi.advanceTimersByTimeAsync(0);
    expect(check.runs()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    const responses = await Promise.all(pending);

    expect(check.runs()).toBe(1);
    expect(responses).toHaveLength(10);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(textOf(response)).toBe('{"status":"ok"}');
    }
  });

  // §6.8. "An empty set is not a failure; a process with no dependencies is ready." The
  // interesting half is the *absent* key rather than the empty array, because an
  // implementation that reduces with `every` gets both right and one that reduces with
  // `some` gets both wrong.
  it('answers 200 from both probes with no checks registered', async () => {
    const empty = healthRoutes({});
    expect(empty.live().status).toBe(200);
    expect(textOf(empty.live())).toBe('{"status":"ok"}');
    expect((await empty.ready()).status).toBe(200);
    expect(textOf(await empty.ready())).toBe('{"status":"ok"}');

    const explicitlyEmpty = healthRoutes({ liveness: [], readiness: [] });
    expect(explicitlyEmpty.live().status).toBe(200);
    expect((await explicitlyEmpty.ready()).status).toBe(200);
  });

  // §6.9. A check that throws is a failed check, not a failed endpoint — so a 503 rather
  // than the 500 an unhandled rejection would produce — and the thrown message must not
  // reach the public body. The message here is deliberately the shape of a real driver error,
  // because that is what actually gets thrown and what actually leaks.
  it('treats a check that throws as a failed check, not a failed endpoint', async () => {
    const thrower: ReadinessCheck = {
      name: 'db',
      timeoutMs: 1000,
      run: () => Promise.reject(new Error('password authentication failed for user "svc_orders"')),
    };
    const synchronousThrower: ReadinessCheck = {
      name: 'cache',
      timeoutMs: 1000,
      run: () => {
        throw new TypeError('client is not connected');
      },
    };

    const probes = healthRoutes({ readiness: [thrower, synchronousThrower, instantCheck('ok', { ok: true })] });
    const response = await probes.ready();

    expect(response.status).toBe(503);
    expect(textOf(response)).toBe('{"status":"error"}');
    expect(textOf(response)).not.toContain('svc_orders');
    expect(textOf(response)).not.toContain('password');
    expect(textOf(response)).not.toContain('not connected');

    // The detailed form records the failure without the message: §3's table has `detail` on a
    // failed check, and a thrown message is not a detail this module is willing to forward.
    const detailed = await detailedReadyRoute({ readiness: [thrower] })();
    const body = bodyOf(detailed);
    expect(body.checks.find(c => c.name === 'db')?.ok).toBe(false);
    expect(textOf(detailed)).not.toContain('svc_orders');

    // A liveness check that throws is the same rule: 503, not a crashed endpoint. This is the
    // one place `run(): boolean` cannot help, because a synchronous throw is still a throw.
    const live = healthRoutes({
      liveness: [
        {
          name: 'event-loop',
          run: () => {
            throw new RangeError('Maximum call stack size exceeded');
          },
        },
      ],
    });
    expect(live.live().status).toBe(503);
    expect(textOf(live.live())).toBe('{"status":"error"}');
  });

  // §4's honest limit, asserted so that #581 "does not quietly implement a `timeoutMs` that
  // reads as if it cancels". The signal is delivered and aborted — that part is real and a
  // check may use it for anything that accepts one — but `Driver.execute` takes no signal
  // (`packages/repository/src/index.ts:51-54`), so the work keeps running. The assertion is
  // therefore about what the framework *does*, not about what stops: the signal aborts, and
  // the abandoned promise resolving later changes nothing.
  it('aborts the signal at the deadline and ignores an answer that arrives afterwards', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    let settle: ((result: CheckResult) => void) | undefined;
    const abandoned: ReadinessCheck = {
      name: 'db',
      timeoutMs: 1000,
      run: signal => {
        seen = signal;
        return new Promise<CheckResult>(resolve => {
          settle = resolve;
        });
      },
    };

    const probes = healthRoutes({ readiness: [abandoned] });
    let responseSettled = false;
    const pending = probes.ready().then(response => {
      responseSettled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(seen?.aborted).toBe(false);
    expect(responseSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen?.aborted).toBe(true);
    expect(responseSettled).toBe(false);

    // A success arriving after the declared deadline but before the 50ms scheduling
    // allowance expires is still a timeout, never a cacheable success.
    settle?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(responseSettled).toBe(true);

    // The late success did not retroactively mark the probe healthy or resolve it twice.
    await vi.advanceTimersByTimeAsync(1);
    expect(response.status).toBe(503);

    // And because a failure is never cached (§5), the next call runs the check again rather
    // than serving the abandoned one's eventual answer.
    const second = probes.ready();
    await vi.advanceTimersByTimeAsync(1050);
    expect((await second).status).toBe(503);
  });

  it('ships a database readiness check that executes only SELECT 1', async () => {
    const calls: unknown[] = [];
    let observedSignal: AbortSignal | undefined;
    const check = databaseReadinessCheck(
      {
        execute: (query, options) => {
          calls.push(query);
          observedSignal = options?.signal;
          return Promise.resolve([]);
        },
      },
      { name: 'primary-db', timeoutMs: 250, cacheMs: 2000 },
    );

    expect(check.name).toBe('primary-db');
    expect(check.timeoutMs).toBe(250);
    expect(check.cacheMs).toBe(2000);
    const signal = new AbortController().signal;
    expect(await check.run(signal)).toEqual({ ok: true });
    expect(calls).toEqual([{ text: 'SELECT 1', parameters: [] }]);
    expect(observedSignal).toBe(signal);
  });
});
