> **ToDo / feature gap.** There is no scheduler — no `@Cron`, no `@Interval`, no
> `ScheduleModule`. The only lifecycle hooks are `onModuleInit`,
> `onApplicationBootstrap` and `onShutdown`, and they run on
> [controllers only](./web-standalone.html).

## The decision that matters more than the missing decorator

Where the schedule lives determines whether your job runs twice, or not at all.

| Approach                                  | Runs once across replicas? | Survives a restart? | Use when                               |
| ----------------------------------------- | -------------------------- | ------------------- | -------------------------------------- |
| `setInterval` in the process              | **No** — once per replica  | No                  | single instance, best-effort work      |
| Advisory lock + interval                  | Yes                        | Yes                 | you have Postgres and several replicas |
| Platform cron hitting an HTTP route       | Yes                        | Yes                 | most deployments                       |
| External scheduler (Kubernetes `CronJob`) | Yes                        | Yes                 | you already run Kubernetes             |

A `@Cron` decorator gives you the first row — and the first row is wrong for any deployment with more than one instance. Three replicas means three concurrent runs of your nightly billing job. That is why this gap is less painful than it appears: the correct answer is usually external anyway.

## Recommended — a platform cron calling a route

```ts
@Controller('/jobs')
export class JobsController {
  @Inject(REPORTS) private readonly reports!: ReportService;

  @Post('/nightly-digest')
  async digest(ctx: Ctx<Record<never, string>, unknown>) {
    requireJobSecret(ctx.headers);
    const sent = await this.reports.sendDigests();
    return { sent };
  }
}
```

```ts
function requireJobSecret(headers: Readonly<Record<string, string>>): void {
  const given = headers['x-job-secret'] ?? '';
  const expected = env.JOB_SECRET;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ValidationError('unauthorized', []);
}
```

> [!WARNING]
> A job route is a public HTTP endpoint. Without authentication, anyone can trigger
> your nightly billing run repeatedly. Use a shared secret compared with
> `timingSafeEqual` (never `===`, which leaks the secret byte by byte through
> timing), or restrict by source — Vercel and Cloud Scheduler both provide a
> verifiable header.

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
- **The lock is held on a session.** If your driver uses a pool, the lock and the unlock must be on the same connection, or the unlock is a no-op and the lock leaks until that connection closes. A dedicated connection for the scheduler avoids this.
- **`unref()`** so the timer does not hold the process open.
- **`clearInterval` in `onShutdown`**, or a rolling deploy leaves the old process ticking.

Note that `onApplicationBootstrap` runs on **controllers**, so the scheduler has to be a controller class — even if it has no useful routes. That is an artefact of the hook detection, not a design intent.

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

A `@Cron('0 3 * * *')` decorator plus a cron parser (a dependency, or ~150 lines), a scheduler that starts on bootstrap, and hook detection extended to providers. All tractable.

The design question that would need answering first is coordination: shipping a decorator that fires per replica would be shipping a footgun, so it would have to come with a pluggable lock — at which point the useful part is the lock, and the decorator is sugar over `setInterval`.

---

See also: [Queues](./web-queues.html) · [Transactional Outbox](./transactional-outbox.html) · [Standalone Applications](./web-standalone.html)
