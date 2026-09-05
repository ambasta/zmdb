// @zmdb/web — HTTP liveness and readiness routes (#581, epic #578).
// Liveness is synchronous by type. Readiness is concurrent, bounded, success-cached,
// and coalesced while a probe invocation is still waiting.

import type { CheckResult, DetailedCheck, HealthChecks, LivenessCheck, ReadinessCheck } from '@zmdb/app/health';

import { json, type WebResponse } from '../pipeline/index.js';

const DEFAULT_CACHE_MS = 1000;
const DEADLINE_GRACE_MS = 50;

export interface HealthProbes {
  readonly live: () => WebResponse;
  readonly ready: () => Promise<WebResponse>;
}

export interface DetailedBody {
  readonly status: 'ok' | 'error';
  readonly checks: readonly DetailedCheck[];
}

interface CachedSuccess {
  readonly expiresAt: number;
  readonly result: DetailedCheck;
}

interface CheckState {
  cached?: CachedSuccess;
  inFlight?: Promise<DetailedCheck>;
}

interface ReadinessRunner {
  run(): Promise<readonly DetailedCheck[]>;
}

function createCheckState(): CheckState {
  return {};
}

function publicResponse(ok: boolean): WebResponse {
  return json({ status: ok ? 'ok' : 'error' }, ok ? {} : { status: 503 });
}

function runLiveness(checks: readonly LivenessCheck[]): boolean {
  for (const check of checks) {
    try {
      if (!check.run()) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function createReadinessRunner(checks: readonly ReadinessCheck[]): ReadinessRunner {
  const entries = checks.map(check => ({ check, state: createCheckState() }));

  return {
    run: () => {
      if (entries.length === 0) {
        return Promise.resolve([]);
      }

      const completed: (DetailedCheck | undefined)[] = entries.map(() => undefined);
      const running = entries.map(({ check, state }, index) =>
        runReadinessCheck(check, state).then(result => {
          completed[index] = result;
          return result;
        }),
      );
      const aggregateDeadline = Math.max(...entries.map(({ check }) => check.timeoutMs)) + DEADLINE_GRACE_MS;
      const startedAt = Date.now();

      return new Promise(resolve => {
        let settled = false;
        const finish = (results: readonly DetailedCheck[]): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(results);
        };
        const timer = setTimeout(() => {
          finish(
            entries.map(
              ({ check }, index): DetailedCheck =>
                completed[index] ?? {
                  name: check.name,
                  ok: false,
                  detail: 'timeout',
                  durationMs: Math.max(0, Date.now() - startedAt),
                },
            ),
          );
        }, aggregateDeadline);

        void Promise.all(running).then(finish);
      });
    },
  };
}

function runReadinessCheck(check: ReadinessCheck, state: CheckState): Promise<DetailedCheck> {
  const now = Date.now();
  if (state.cached !== undefined) {
    if (now < state.cached.expiresAt) {
      return Promise.resolve(state.cached.result);
    }
    delete state.cached;
  }
  if (state.inFlight !== undefined) {
    return state.inFlight;
  }

  const startedAt = now;
  const controller = new AbortController();
  const pending = new Promise<DetailedCheck>(resolve => {
    let settled = false;
    let timedOut = false;
    const finish = (result: CheckResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(abortTimer);
      clearTimeout(deadlineTimer);
      const detailed = {
        name: check.name,
        ok: result.ok,
        ...(result.detail === undefined ? {} : { detail: result.detail }),
        durationMs: Math.max(0, Date.now() - startedAt),
      };
      if (result.ok) {
        state.cached = {
          expiresAt: Date.now() + (check.cacheMs ?? DEFAULT_CACHE_MS),
          result: detailed,
        };
      }
      resolve(detailed);
    };

    const abortTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, check.timeoutMs);
    const deadlineTimer = setTimeout(() => {
      finish({ ok: false, detail: 'timeout' });
    }, check.timeoutMs + DEADLINE_GRACE_MS);

    try {
      void check.run(controller.signal).then(
        result => finish(timedOut ? { ok: false, detail: 'timeout' } : result),
        () => finish(timedOut ? { ok: false, detail: 'timeout' } : { ok: false }),
      );
    } catch {
      finish({ ok: false });
    }
  });

  state.inFlight = pending;
  void pending.finally(() => {
    if (state.inFlight === pending) {
      delete state.inFlight;
    }
  });
  return pending;
}

/** Build the public liveness and readiness handlers from this application's explicit checks. */
export function healthRoutes(checks: HealthChecks): HealthProbes {
  const liveness = checks.liveness ?? [];
  const readiness = createReadinessRunner(checks.readiness ?? []);
  return {
    live: () => publicResponse(runLiveness(liveness)),
    ready: async () => {
      const results = await readiness.run();
      return publicResponse(results.every(result => result.ok));
    },
  };
}

/**
 * Build the opt-in detailed readiness handler.
 *
 * Mount this separate handler through the application's normal RouteOptions.guards composition.
 * The public handlers returned by healthRoutes never expose names, details, or timings.
 */
export function detailedReadyRoute(checks: HealthChecks): () => Promise<WebResponse> {
  const readiness = createReadinessRunner(checks.readiness ?? []);
  return async () => {
    const results = await readiness.run();
    const ok = results.every(result => result.ok);
    return json({ status: ok ? 'ok' : 'error', checks: results }, ok ? {} : { status: 503 });
  };
}
