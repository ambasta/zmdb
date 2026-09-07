import { createQueue, createWorker, jobsExtension } from '@zmdb/jobs';
import type {
  ClaimedJob,
  Clock,
  DeadJob,
  DeadReason,
  JobCandidate,
  JobEnqueue,
  JobEnqueueResult,
  JobEnqueuer,
  JobSettlement,
  JobStore,
  JobStoreMigration,
  JobStoreResource,
  LeaseStore,
} from '@zmdb/jobs';

type ExpectedStoreKeys = 'enqueue' | 'candidates' | 'claim' | 'completed' | 'settle' | 'listDead' | 'replay';
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;
export type StoreHasOnlyDomainPorts = Expect<Equal<keyof JobStore, ExpectedStoreKeys>>;
export type ClaimResult = Expect<Equal<Awaited<ReturnType<JobStore['claim']>>, readonly ClaimedJob[]>>;
export type CandidateResult = Expect<Equal<Awaited<ReturnType<JobStore['candidates']>>, readonly JobCandidate[]>>;
export type EnqueueInput = Expect<Equal<Parameters<JobStore['enqueue']>[0], JobEnqueue>>;
export type EnqueueResult = Expect<Equal<Awaited<ReturnType<JobStore['enqueue']>>, JobEnqueueResult>>;
export type SettlementInput = Expect<Equal<Parameters<JobStore['settle']>[0], JobSettlement>>;

interface ExpectedEnqueue {
  readonly id: string;
  readonly name: string;
  readonly payload: string;
  readonly enqueuedAt: Date;
  readonly availableAt: Date;
  readonly dedupeKey?: string;
}
interface ExpectedCandidate {
  readonly id: string;
  readonly name: string;
  readonly enqueuedAt: Date;
}
interface ExpectedClaimed extends ExpectedCandidate {
  readonly payload: string;
  readonly attempts: number;
  readonly dedupeKey?: string;
  readonly holder: string;
}
type ExpectedSettlement =
  | {
      readonly kind: 'done';
      readonly jobId: string;
      readonly holder: string;
      readonly idempotencyKey: string;
      readonly completedAt: Date;
    }
  | {
      readonly kind: 'retry';
      readonly jobId: string;
      readonly holder: string;
      readonly attempts: number;
      readonly availableAt: Date;
      readonly detail: string;
    }
  | {
      readonly kind: 'dead';
      readonly jobId: string;
      readonly holder: string;
      readonly attempts: number;
      readonly reason: DeadReason;
      readonly detail: string;
      readonly deadAt: Date;
    }
  | { readonly kind: 'release'; readonly jobId: string; readonly holder: string; readonly availableAt: Date };

export type ExactEnqueue = Expect<Equal<JobEnqueue, ExpectedEnqueue>>;
export type ExactEnqueueResult = Expect<
  Equal<
    JobEnqueueResult,
    { readonly kind: 'inserted'; readonly jobId: string } | { readonly kind: 'duplicate'; readonly jobId: string }
  >
>;
export type ExactCandidate = Expect<Equal<JobCandidate, ExpectedCandidate>>;
export type ExactClaimed = Expect<Equal<ClaimedJob, ExpectedClaimed>>;
export type ExactSettlement = Expect<Equal<JobSettlement, ExpectedSettlement>>;
export type ExactEnqueuer = Expect<Equal<JobEnqueuer, { enqueue(job: JobEnqueue): Promise<JobEnqueueResult> }>>;
export type ExactCandidateMethod = Expect<
  Equal<
    JobStore['candidates'],
    (options: { readonly now: Date; readonly limit: number }) => Promise<readonly JobCandidate[]>
  >
>;
export type ExactClaimMethod = Expect<
  Equal<
    JobStore['claim'],
    (options: {
      readonly ids: readonly string[];
      readonly holder: string;
      readonly now: Date;
      readonly leaseUntil: Date;
    }) => Promise<readonly ClaimedJob[]>
  >
>;
export type ExactCompletedMethod = Expect<Equal<JobStore['completed'], (key: string) => Promise<boolean>>>;
export type ExactSettlementMethod = Expect<Equal<JobStore['settle'], (settlement: JobSettlement) => Promise<boolean>>>;
export type ExactDeadMethod = Expect<
  Equal<
    JobStore['listDead'],
    (options: { readonly limit: number; readonly reason?: DeadReason }) => Promise<readonly DeadJob[]>
  >
>;
export type ExactReplayMethod = Expect<
  Equal<JobStore['replay'], (jobId: string, availableAt: Date) => Promise<boolean>>
>;
export type ExactResource = Expect<
  Equal<JobStoreResource, { close(options?: { readonly graceMs: number }): void | Promise<void> }>
>;
export type ExactLease = Expect<
  Equal<
    LeaseStore,
    {
      acquire(key: string, holder: string, ttlMs: number): Promise<boolean>;
      renew(key: string, holder: string, ttlMs: number): Promise<boolean>;
      release(key: string, holder: string): Promise<void>;
    }
  >
>;
export type ExactMigration = Expect<
  Equal<
    JobStoreMigration,
    {
      readonly version: number;
      readonly name: string;
      readonly up: string;
      readonly down: string;
    }
  >
>;

export function acceptedPorts(
  store: JobStore,
  enqueuer: JobEnqueuer,
  clock: Clock,
  resource: JobStoreResource,
  lease: LeaseStore,
): void {
  const queue = createQueue<{ deliver: { id: number } }>({ store, clock });
  void queue.enqueue('deliver', { id: 1 });
  void queue.enqueueInTransaction(enqueuer, 'deliver', { id: 2 });
  const worker = createWorker<{ deliver: { id: number } }>({
    handlers: [
      {
        name: 'deliver',
        validate: () => ({ id: 1 }),
        handle: async payload => {
          void payload.id;
        },
      },
    ],
    store,
    clock,
    concurrency: 1,
    graceMs: 100,
    leaseMs: 1000,
    timeoutMs: 100,
    onDead: () => undefined,
    onHandlerError: () => undefined,
  });
  jobsExtension({ workers: [worker], stores: [resource] });
  void lease.acquire('scheduled', 'holder', 1000);
}

export function migrationShape(migrations: readonly JobStoreMigration[]): readonly number[] {
  return migrations.map(migration => migration.version);
}
