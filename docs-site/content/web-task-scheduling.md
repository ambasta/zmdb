## Scale-out is the first decision

Three replicas run an in-process timer three times. That is correct for a local cache refresh and a billing defect for a cluster-wide job, so every schedule must choose explicitly:

| `runs` value       | Behaviour                                        | Typical use                      |
| ------------------ | ------------------------------------------------ | -------------------------------- |
| `once-per-replica` | every application instance runs the task         | local cache or connection state  |
| `once-per-cluster` | one instance acquires a renewable per-task lease | billing, cleanup, reconciliation |

There is no default. Constructing a scheduler with a `once-per-cluster` task and no `leases` throws before the loop starts; it never silently degrades to one run per replica.

`LeaseStore` is structural, so the application can implement it over the database or coordination service it already operates:

```ts
interface LeaseStore {
  acquire(key: string, holder: string, ttlMs: number): Promise<boolean>;
  renew(key: string, holder: string, ttlMs: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
}
```

The scheduler acquires a lease named after the task before invoking it, renews at one third of `leaseMs`, and releases it after settlement or shutdown. A failed acquisition produces
`onSkipped({ reason: 'lease-not-held' })`. A renewal failure reaches `onTaskError` and disables future fires for that task.

A lease bounds concurrent **starters**, not every possible runner. A process that stalls beyond its lease can resume after another replica has acquired the same task. Durable work must therefore still
be idempotent.

## Make a double fire harmless

The recommended cluster-wide task is short: calculate a stable business-period key and enqueue durable work with that key.

```ts
import { Cron } from '@zmdb/web/schedule';
import type { Clock, Queue } from '@zmdb/web/queues';

type Jobs = {
  readonly 'billing.run': { readonly runDate: string };
};

class BillingTasks {
  constructor(
    private readonly jobs: Queue<Jobs>,
    private readonly clock: Clock,
  ) {}

  @Cron('0 30 2 * * *', {
    name: 'billing.daily',
    runs: 'once-per-cluster',
    timeZone: 'Europe/Berlin',
    timeoutMs: 30_000,
  })
  async run(): Promise<void> {
    const runDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
    }).format(new Date(this.clock.now()));

    await this.jobs.enqueue('billing.run', { runDate }, { dedupeKey: `billing:${runDate}` });
  }
}
```

The queue's unique deduplication key turns two scheduler fires into one job row. The handler should also use its `ctx.idempotencyKey` completion marker as described in [Queues](./web-queues.html),
because enqueue deduplication and at-least-once delivery are separate races.

## Declare and start the scheduler

`@Cron` and `@Interval` only record declarations. `createScheduler` receives the instances built for one application, so two applications in one process do not share a registry.

```ts
import { Cron, Interval, createScheduler, type LeaseStore } from '@zmdb/web/schedule';
import type { Clock } from '@zmdb/web/queues';

const clock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }

      const timer = setTimeout(done, ms);

      function done(): void {
        signal.removeEventListener('abort', aborted);
        resolve();
      }

      function aborted(): void {
        clearTimeout(timer);
        reject(signal.reason);
      }

      signal.addEventListener('abort', aborted, { once: true });
    });
  },
};

class LocalTasks {
  @Interval(60_000, {
    name: 'cache.refresh',
    runs: 'once-per-replica',
    timeoutMs: 10_000,
  })
  refresh(): void {
    localCache.refresh();
  }
}

declare const billingTasks: BillingTasks;
declare const leases: LeaseStore;

const scheduler = createScheduler({
  tasks: [billingTasks, new LocalTasks()],
  clock,
  leases,
  leaseMs: 60_000,
  graceMs: 15_000,
  onTaskError(task, scheduledFor, error) {
    logger.error({ task, scheduledFor, error });
  },
  onSkipped(skipped) {
    logger.warn(skipped);
  },
});

scheduler.start();
```

Call `start()` explicitly during bootstrap, or from an owning provider's `onApplicationBootstrap`. The scheduler implements `onShutdown()`: registering the constructed scheduler as a value provider
lets application disposal invoke that hook. It installs no process signal handlers.

Use the same `Clock` instance for queues and schedules. Tests can supply a controllable clock; production can use the system-clock implementation above.

## Cron dialect

A five-field expression has normal `crontab(5)` meaning. An optional **leading** seconds field makes six:

```text
┌───────────── second (0-59), optional
│ ┌─────────── minute (0-59)
│ │ ┌───────── hour (0-23)
│ │ │ ┌─────── day of month (1-31)
│ │ │ │ ┌───── month (1-12 or JAN-DEC)
│ │ │ │ │ ┌─── day of week (0-7 or SUN-SAT)
* * * * * *
```

The parser runs once at scheduler construction.

| Construct                                     | Result                                           |
| --------------------------------------------- | ------------------------------------------------ |
| `*`, ranges, lists and steps                  | supported                                        |
| `JAN`–`DEC`, `SUN`–`SAT`, case-insensitive    | supported                                        |
| Sunday as `0` or `7`                          | supported                                        |
| `@yearly`, `@annually`, `@monthly`, `@weekly` | supported                                        |
| `@daily`, `@midnight`, `@hourly`              | supported                                        |
| `@reboot`                                     | refused: startup is not a calendar instant       |
| Quartz `L`, `W`, `#`, `?` or a trailing year  | refused rather than assigned a different dialect |

When both day-of-month and day-of-week are restricted, cron's POSIX **OR** rule applies. `0 0 1 * MON` fires on the first of each month and on every Monday.

An invalid expression, unknown IANA time zone, duplicate task name, non-positive duration, or interval longer than `2_147_483_647` milliseconds is a construction error. Use `@Cron` rather than a
multi-week interval for calendar time.

## Time zones and daylight saving

`timeZone` defaults to `UTC`, never the host's zone. State is stored as an absolute instant; `Intl.DateTimeFormat` converts the requested wall time in the declared IANA zone.

For this declaration:

```ts
@Cron('0 30 2 * * *', {
  runs: 'once-per-cluster',
  timeZone: 'Europe/Berlin',
})
```

the 2026 transitions are:

| Local date                 | Requested wall time    | Fired instant              | Rule                                         |
| -------------------------- | ---------------------- | -------------------------- | -------------------------------------------- |
| 2026-03-29, spring forward | 02:30 (does not exist) | `2026-03-29T01:30:00.000Z` | shift forward to 03:30 local                 |
| 2026-10-25, fall back      | 02:30 (occurs twice)   | `2026-10-25T00:30:00.000Z` | choose the earlier occurrence; do not repeat |

The host's `TZ` setting does not participate.

## Overlap, missed runs and failures

Overlap is always prevented; there is no option to enable it.

- A cron instant reached while its previous invocation is still running is reported through `onSkipped` with `reason: 'still-running'`.
- An interval is completion-to-start: its next delay begins only after the previous invocation settles.
- An instant passed during a clock jump or event-loop pause is reported with `reason: 'missed'`. The scheduler does not catch up missed work.
- A cluster task that loses the acquisition race reports `reason: 'lease-not-held'`.

`onTaskError(task, scheduledFor, error)` receives thrown task errors, timeout reports and lease-renewal failures. The scheduler does not retry task bodies: enqueue work when it needs retries and a
dead-letter path.

`timeoutMs` is an observation deadline, not a way to terminate JavaScript. A scheduled method receives no `AbortSignal`, so a method that does not settle remains the active invocation even after its
timeout is reported and continues to prevent overlap. Likewise, `onShutdown()` waits up to `graceMs`, releases held leases and then returns, but it cannot forcibly stop application code. A resumed old
runner can overlap a replacement, so idempotency remains required.

Both observation callbacks are isolated: if logging throws, it does not stop the scheduler or replace the original error.

## When an external scheduler is still better

A platform cron, Kubernetes `CronJob`, EventBridge or another managed scheduler remains a good fit when operations needs a provider-owned run history or does not want timers inside the application.
Authenticate any HTTP endpoint it calls, and keep the same idempotency rule: an external trigger may also be retried or delivered again.

---

See also: [Queues](./web-queues.html) · [Transactional Outbox](./transactional-outbox.html) · [Standalone Applications](./web-standalone.html)
