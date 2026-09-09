// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// @zmdb/jobs — queues, workers, scheduling and app lifecycle integration.

export { jobsExtension } from './extension.js';
export { createQueue, createWorker } from './queues/index.js';
export { Cron, Interval, createScheduler, schedulesOf } from './schedule/index.js';
export type {
  AnyJobHandler,
  Backoff,
  Clock,
  DeadJob,
  DeadReason,
  EnqueueOptions,
  JobContext,
  ClaimedJob,
  JobCandidate,
  JobEnqueue,
  JobEnqueuer,
  JobEnqueueResult,
  JobSettlement,
  JobStoreResource,
  JobStoreMigration,
  JobHandler,
  JobOutcome,
  JobStore,
  Queue,
  QueueOptions,
  RetryPolicy,
  RunReport,
  Worker,
  WorkerOptions,
} from './queues/index.js';
export type {
  IntervalOptions,
  LeaseStore,
  ScheduleDef,
  Scheduler,
  SchedulerOptions,
  SkippedRun,
  TaskDecorator,
  TaskOptions,
  TaskRuns,
} from './schedule/index.js';
