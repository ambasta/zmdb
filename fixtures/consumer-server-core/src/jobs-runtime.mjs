const jobs = await import('@zmdb/jobs');
const memory = await import('@zmdb/jobs/memory');
const schedule = await import('@zmdb/jobs/schedule');

if (jobs.createMemoryJobStore !== memory.createMemoryJobStore) {
  throw new Error('@zmdb/jobs changed the memory subpath identity');
}
if (jobs.createScheduler !== schedule.createScheduler) {
  throw new Error('@zmdb/jobs changed the schedule subpath identity');
}

const log = [];
const extension = jobs.jobsExtension({
  workers: [
    {
      start() {
        log.push('start:worker');
      },
      onShutdown({ graceMs }) {
        log.push(`stop:worker:${String(graceMs)}`);
        return Promise.resolve();
      },
    },
  ],
  schedulers: [
    {
      start() {
        log.push('start:scheduler');
      },
      onShutdown({ graceMs }) {
        log.push(`stop:scheduler:${String(graceMs)}`);
        return Promise.resolve();
      },
    },
  ],
});
extension.start({});
await extension.stop({ graceMs: 100 });
if (
  extension.name !== '@zmdb/jobs' ||
  JSON.stringify(log) !== JSON.stringify(['start:worker', 'start:scheduler', 'stop:scheduler:100', 'stop:worker:100'])
) {
  throw new Error(`installed jobs extension lifecycle mismatch: ${JSON.stringify(log)}`);
}

const clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  },
};

using store = memory.createMemoryJobStore();
const objects = store.database
  .prepare(
    `SELECT name, type FROM sqlite_master
     WHERE name IN ('zmdb_job', 'zmdb_job_done', 'zmdb_job_pending')
     ORDER BY name`,
  )
  .all();
if (
  JSON.stringify(objects) !==
  JSON.stringify([
    { name: 'zmdb_job', type: 'table' },
    { name: 'zmdb_job_done', type: 'table' },
    { name: 'zmdb_job_pending', type: 'index' },
  ])
) {
  throw new Error(`installed memory backend schema mismatch: ${JSON.stringify(objects)}`);
}

const delivered = [];
const queue = jobs.createQueue({ store, clock });
const worker = jobs.createWorker({
  handlers: [
    {
      name: 'deliver',
      validate(raw) {
        if (typeof raw !== 'object' || raw === null || typeof raw.id !== 'number') {
          throw new Error('deliver requires a numeric id');
        }
        return { id: raw.id };
      },
      handle(payload) {
        delivered.push(payload.id);
        return Promise.resolve();
      },
    },
  ],
  store,
  clock,
  concurrency: 1,
  graceMs: 100,
  leaseMs: 60_000,
  onDead: () => undefined,
  onHandlerError: () => undefined,
});
await queue.enqueue('deliver', { id: 7 });
const report = await worker.runOnce();
if (JSON.stringify(delivered) !== '[7]' || report.done !== 1) {
  throw new Error(`installed worker did not consume the queued job: ${JSON.stringify({ delivered, report })}`);
}

const scheduler = schedule.createScheduler({
  tasks: [],
  clock,
  onTaskError: () => undefined,
  onSkipped: () => undefined,
});
await scheduler.tick(clock.now());
await scheduler.onShutdown({ graceMs: 0 });

console.log(
  JSON.stringify({
    extensionOrder: log,
    queueDone: report.done,
    schemaObjects: objects.length,
    subpathIdentity: true,
  }),
);
