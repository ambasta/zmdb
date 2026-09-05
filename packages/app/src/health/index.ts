import type { Driver } from '@zmdb/repository';

/** The process is not wedged. Synchronous by construction. */
export interface LivenessCheck {
  readonly name: string;
  run(): boolean;
}

export interface CheckResult {
  readonly ok: boolean;
  readonly detail?: string;
}

/** The process can serve traffic. Dependencies receive an explicit deadline. */
export interface ReadinessCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly cacheMs?: number;
  run(signal: AbortSignal): Promise<CheckResult>;
}

export interface HealthChecks {
  readonly liveness?: readonly LivenessCheck[];
  readonly readiness?: readonly ReadinessCheck[];
}

export interface DetailedCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
  readonly durationMs?: number;
}

export interface DatabaseReadinessOptions {
  readonly name?: string;
  readonly timeoutMs: number;
  readonly cacheMs?: number;
}

/** Build the protocol-neutral readiness check for one required database. */
export function databaseReadinessCheck(
  driver: Pick<Driver, 'execute'>,
  options: DatabaseReadinessOptions,
): ReadinessCheck {
  return {
    name: options.name ?? 'database',
    timeoutMs: options.timeoutMs,
    ...(options.cacheMs === undefined ? {} : { cacheMs: options.cacheMs }),
    async run(signal) {
      await driver.execute({ text: 'SELECT 1', parameters: [] }, { signal });
      return { ok: true };
    },
  };
}
