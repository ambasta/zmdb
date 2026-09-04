> **ToDo / feature gap.** There is no scheduler yet, but the design is no longer open:
> `@Cron`, `@Interval`, the cron dialect, the daylight-saving rules and the per-task
> lease are frozen in `packages/web/src/schedule/SPEC.md` (#586). A scheduler can be a
> provider: constructed providers receive `onModuleInit`, `onApplicationBootstrap` and
> `onShutdown` through the app lifecycle. The queue half now ships, so a future task can
> enqueue durable, deduplicated work without doing that work while it holds the scheduler lease.

## The decision that matters more than the missing decorator

Where the schedule lives determines whether your job runs twice, or not at all.

| Approach                                  | Runs once across replicas? | Survives a restart? | Use when                               |
| ----------------------------------------- | -------------------------- | ------------------- | -------------------------------------- |
| `setInterval` in the process              | **No** — once per replica  | No                  | single instance, best-effort work      |
| Advisory lock + interval                  | Yes                        | Yes                 | you have Postgres and several replicas |
| Platform cron hitting an HTTP route       | Yes                        | Yes                 | most deployments                       |
| External scheduler (Kubernetes `CronJob`) | Yes                        | Yes                 | you already run Kubernetes             |

A `@Cron` decorator gives you the first row — and the first row is wrong for any deployment with more than one instance. Three replicas means three concurrent runs of your nightly billing job. The frozen decorator therefore has no default for this: `runs` is a required option, either `'once-per-replica'` or `'once-per-cluster'`, because neither is safe for both a cache warmer (which must run everywhere, since each replica has its own cache) and a billing run (which must not). Asking for `'once-per-cluster'` without giving the scheduler a lease store is an error at startup rather than a surprise at 3 a.m.

## Recommended — a platform cron calling a route

```ts
@Controller('/jobs')
export class JobsController {
  @Inject(REPORTS) private readonly reports!: ReportService;

  @Post('/nightly-digest')
  async digest(ctx: Ctx<Record<never, string>, unknown>) {
    await requireJobSecret(ctx.headers);
    const sent = await this.reports.sendDigests();
    return { sent };
  }
}
```

```ts
// A per-process HMAC key. Comparing digests taken under an unpredictable key is
// constant-time enough: an attacker cannot steer the bytes being compared, so a
// byte-by-byte `===` on the digests leaks nothing about the secret.
const compareKey = await globalThis.crypto.subtle.importKey(
  'raw',
  globalThis.crypto.getRandomValues(new Uint8Array(32)),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const encoder = new TextEncoder();

async function digest(value: string): Promise<string> {
  const mac = await globalThis.crypto.subtle.sign('HMAC', compareKey, encoder.encode(value));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function requireJobSecret(headers: Readonly<Record<string, string>>): Promise<void> {
  const given = headers['x-job-secret'] ?? '';
  if ((await digest(given)) !== (await digest(env.JOB_SECRET))) {
    throw new ValidationError('unauthorized', []);
  }
}
```

The obvious version of this — `timingSafeEqual(Buffer.from(given), Buffer.from(expected))` — is what most guides show, and it is not available here. `.oxlintrc.json` restricts the `Buffer` global along with `Buffer.from`, `Buffer.alloc`, `Buffer.concat` and `Buffer.byteLength`, and it restricts the `node:crypto` import with the message _"Use globalThis.crypto and the Web Crypto API."_ — which is where `timingSafeEqual` lives. Web Crypto has no equivalent, so the replacement is the double-HMAC construction above rather than a mechanical substitution.

The digest is always 64 characters regardless of the input's length, which is why the explicit length check the `Buffer` version needed disappears: a length difference is already a digest difference.

> [!WARNING]
> A job route is a public HTTP endpoint. Without authentication, anyone can trigger
> your nightly billing run repeatedly. Use a shared secret compared in constant
> time — never a bare `===` on the secret itself, which leaks it byte by byte
> through timing — or restrict by source; Vercel and Cloud Scheduler both provide
> a verifiable header.

Wire it up per platform:

```json
// vercel.json
{ "crons": [{ "path": "/api/jobs/nightly-digest", "schedule": "0 3 * * *" }] }
```

```yaml
# Kubernetes
apiVersion: batch/v1
kind: CronJob
spec:
  schedule: '0 3 * * *'
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: curl
              image: curlimages/curl
              args: ['-fsS', '-XPOST', '-H', 'x-job-secret: $(SECRET)', 'http://api/jobs/nightly-digest']
          restartPolicy: OnFailure
```

Also: GitHub Actions `schedule`, Cloud Scheduler, EventBridge, Railway cron, `systemd` timers. All of them run once, retry on failure and give you a run history — none of which an in-process interval does.

## In-process, with a lock

When you want the schedule in your code and you have Postgres:

```ts
async function withLock(driver: Driver, key: number, fn: () => Promise<void>): Promise<void> {
  const [row] = await driver.execute({
    text: 'SELECT pg_try_advisory_lock($1) AS acquired',
    parameters: [key],
  });
  if (row?.acquired !== true) return; // another replica has it
  try {
    await fn();
  } finally {
    await driver.execute({ text: 'SELECT pg_advisory_unlock($1)', parameters: [key] });
  }
}
```

```ts
@Controller('/internal')
export class SchedulerController implements OnApplicationBootstrap, OnShutdown {
  @Inject(DRIVER) private readonly driver!: Driver;
  #timer?: NodeJS.Timeout;

  onApplicationBootstrap() {
    this.#timer = setInterval(() => {
      void withLock(this.driver, 42, () => this.run()).catch(e => console.error(String(e)));
    }, 60_000);
    this.#timer.unref();
  }

  onShutdown() {
    if (this.#timer !== undefined) clearInterval(this.#timer);
  }
}
```

Four details:

- **`pg_try_advisory_lock`, not `pg_advisory_lock`.** The blocking version queues every replica, so they run in sequence instead of one running.
- **The lock is held on a session.** If your driver uses a pool, the lock and the unlock must be on the same connection, or the unlock is a no-op and the lock leaks until that connection closes. A dedicated connection for the scheduler avoids this. This is also the reason the frozen scheduler does not use advisory locks: a session lock cannot expire, so a process that is wedged but still connected holds it forever and recovery needs a human, where a lease's worst case is bounded by its TTL and needs nobody. It is Postgres-only besides.
- **`unref()`** so the timer does not hold the process open.
- **`clearInterval` in `onShutdown`**, or a rolling deploy leaves the old process ticking.

Register this scheduler as a provider rather than as a route-free controller.
A value provider is initialized at `app.init()` and drained at disposal; a
factory provider participates once something actually resolves it.

## Idempotency, which is the part people skip

Every scheduler retries, and every distributed lock has an edge case. Assume your job may run twice and make that harmless:

```ts
await driver.execute({
  text: 'INSERT INTO job_runs (name, run_date) VALUES ($1, $2) ON CONFLICT DO NOTHING',
  parameters: ['nightly-digest', today],
});
```

If the insert affected no rows, today's run already happened — return. A unique constraint is a more reliable guard than a lock, because it survives a process death mid-job.

## What it would take

The design question this section used to name — coordination — is answered, in `packages/web/src/schedule/SPEC.md` (#586). It is a per-task lease rather than a pluggable lock, held while the task runs and renewed at a third of its TTL, and it is per task rather than per process so that fifty tasks spread across replicas instead of piling onto whichever one won a global election.

What #589 still owns is a cron parser (~150 lines; no dependency, and the dialect is frozen so that a five-field expression means exactly what `crontab(5)` means, including the surprising day-of-month/day-of-week OR), the scheduler loop, lease coordination and scheduled cleanup of queue completion markers. Provider lifecycle support is already present.

Two things the freeze settled that are worth knowing before you write your own. **The scheduler's state is an absolute instant, not a wall-clock time**, which is what makes daylight saving one conversion rule instead of two special cases: a 02:30 task in `Europe/Berlin` fires once on the spring-forward day, at 03:30 local, and once on the fall-back day, at the earlier of the two 02:30s. `Date` cannot represent a zoned wall-clock time at all — `new Date('2026-03-29T02:30:00')` is parsed in the _host_ zone, which is the thing a scheduler must not depend on — and `Temporal` is not in Node yet, so this is `Intl.DateTimeFormat` and `formatToParts`. And **`timeZone` defaults to `'UTC'` and never to the host zone**, because the host zone is a container setting and a base-image bump should not move your nightly job.

A second trap worth knowing if you write the timer yourself: `setTimeout`'s delay is coerced to a signed 32-bit integer, so anything past **24.86 days** does not wait. `setTimeout(fn, 2_147_483_648)` logs a `TimeoutOverflowWarning` and fires immediately, which turns a naive `@Interval(THIRTY_DAYS)` into a busy loop. The frozen design refuses that interval at registration and points you at `@Cron`, where "the first of the month" is expressible in the first place.

The idempotency section above is still the important part, and it composes with the other half of this epic: the recommended shape for anything that must not be lost is a scheduled task that only **enqueues** — `enqueue('billing.run', …, { dedupeKey: 'billing:2026-03-29' })` — because the queue's unique index turns a double fire into one row, which is a far weaker thing to need from a lease than exactness.

---

See also: [Queues](./web-queues.html) · [Transactional Outbox](./transactional-outbox.html) · [Standalone Applications](./web-standalone.html)
