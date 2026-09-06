import {
  Cron,
  Interval,
  createScheduler,
  createQueue,
  createWorker,
  jobsExtension,
  schedulesOf,
  type Clock,
} from '@zmdb/jobs';
import {
  Cron as ScheduleCron,
  Interval as ScheduleInterval,
  createScheduler as createScheduleScheduler,
  schedulesOf as scheduleDefinitionsOf,
} from '@zmdb/jobs/schedule';

for (const [name, rootValue, subpathValue] of [
  ['Cron', Cron, ScheduleCron],
  ['Interval', Interval, ScheduleInterval],
  ['createScheduler', createScheduler, createScheduleScheduler],
  ['schedulesOf', schedulesOf, scheduleDefinitionsOf],
] as const) {
  if (rootValue !== subpathValue) {
    throw new Error(`@zmdb/jobs root duplicated ${name}`);
  }
}

const clock: Clock = {
  now: () => 0,
  sleep: () => Promise.resolve(),
};

class ClusterTasks {
  @Interval(1000, { runs: 'once-per-cluster', name: 'provider-required' })
  run(): void {}
}

let missingLease = '';
try {
  createScheduler({
    tasks: [new ClusterTasks()],
    clock,
    onTaskError: () => undefined,
    onSkipped: () => undefined,
  });
} catch (error) {
  missingLease = error instanceof Error ? error.message : String(error);
}
if (!missingLease.includes('once-per-cluster schedules require leases')) {
  throw new Error(`missing LeaseStore did not fail explicitly: ${missingLease}`);
}

process.stdout.write(
  `${JSON.stringify({
    values: [createQueue, createWorker, jobsExtension, Cron, Interval, createScheduler, schedulesOf].map(
      value => typeof value,
    ),
    missingLease,
  })}\n`,
);
