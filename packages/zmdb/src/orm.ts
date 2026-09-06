// Repository, transaction, loading, caching, seeding, outbox, replica, and
// entity-modeling concern. Database clients remain selected driver subpaths.

export {
  BaseRepository,
  IncompleteKeyError,
  ValidationError,
  batch,
  createLoaderScope,
  createTransactionalDb,
  defineRepository,
  markTransactionClosed,
  memoryStore,
} from '@zmdb/repository';
export type {
  ActiveTransactionContext,
  ArgsOf,
  CacheInvalidationOptions,
  CacheOptions,
  CacheStore,
  ClosedTransactionContext,
  DatabaseVertical,
  DefineRepositoryOptions,
  Driver,
  EntityLoader,
  ExecuteOptions,
  FilterDef,
  FilterOverride,
  FilterOverrides,
  FilterParams,
  FilterPredicate,
  LoaderScope,
  NumericColumnOf,
  QueryMeta,
  ReadOptions,
  RelationLoader,
  RelationValueOf,
  RepositoryAggregateBuilder,
  RepositoryOptions,
  ResultOf,
  StreamOptions,
  TransactionContext,
  TransactionOptions,
  TransactionRetryPolicy,
  TransactionState,
  TransactionalDb,
  TransactionalDriver,
  TxConnection,
  UpdatePatch,
  UpsertOptions,
  ValidationIssue,
  WriteOptions,
} from '@zmdb/repository';

export { makeRng, seedRows } from '@zmdb/repository/seeding';
export type { SeedOptions } from '@zmdb/repository/seeding';

export { OutboxSchema, createOutboxDispatcher, outboxWriter } from '@zmdb/repository/outbox';
export type {
  DeadOutboxRow,
  OutboxDispatcher,
  OutboxDispatcherOptions,
  OutboxRow,
  OutboxStatus,
  OutboxWriter,
} from '@zmdb/repository/outbox';

export { isWrite, withReplicas } from '@zmdb/repository/replicas';
export type { ReplicaOptions } from '@zmdb/repository/replicas';

export { makeEndpoint } from '@zmdb/repository/integrations';
export type { EndpointResult, Handler } from '@zmdb/repository/integrations';

export {
  EventBus,
  discriminatorFor,
  flattenEmbeddable,
  liftEmbeddable,
  rowToSubtype,
} from '@zmdb/repository/entity-modeling';
export type { LifecycleEvent, SingleTableInheritance, Subscriber } from '@zmdb/repository/entity-modeling';

export { jobPendingIndexDdl } from '@zmdb/repository/jobs';
export type { JobDeadReason, JobDoneRow, JobRow, JobStatus } from '@zmdb/repository/jobs';

export {
  OUTBOX_TABLE,
  outboxCandidatesQuery,
  outboxClaimQuery,
  outboxMarkDeadQuery,
  outboxMarkDeliveredQuery,
  outboxMarkRetryQuery,
  outboxMigration,
  outboxPendingIndexDdl,
  outboxReadBackQuery,
  outboxTableDdl,
} from '@zmdb/query-compiler/outbox';
