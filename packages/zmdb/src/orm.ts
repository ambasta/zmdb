// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
} from '@zmdb/orm';
export {
  type ActiveTransactionContext,
  type ArgsOf,
  type CacheInvalidationOptions,
  type CacheOptions,
  type CacheStore,
  type ClosedTransactionContext,
  type CreateGraphDTO,
  type DatabaseVertical,
  type DefineRepositoryOptions,
  type Driver,
  type EntityLoader,
  type ExecuteOptions,
  type FilterDef,
  type FilterOverride,
  type FilterOverrides,
  type FilterParams,
  type FilterPredicate,
  type LoaderScope,
  type NumericColumnOf,
  type QueryMeta,
  type ReadOptions,
  type RelationLoader,
  type RelationValueOf,
  type RepositoryAggregateBuilder,
  type RepositoryOptions,
  type ResultOf,
  type StreamOptions,
  type TransactionContext,
  type TransactionOptions,
  type TransactionRetryPolicy,
  type TransactionState,
  type TransactionalDb,
  type TransactionalDriver,
  type TxConnection,
  type UpdateGraphDTO,
  type UpdatePatch,
  type UpsertOptions,
  type ValidationIssue,
  type WriteOptions,
} from '@zmdb/orm';

export { makeRng, seedRows } from '@zmdb/orm/seeding';
export { type SeedOptions } from '@zmdb/orm/seeding';

export { OutboxSchema, createOutboxDispatcher, outboxWriter } from '@zmdb/orm/outbox';
export {
  type DeadOutboxRow,
  type OutboxDispatcher,
  type OutboxDispatcherOptions,
  type OutboxRow,
  type OutboxStatus,
  type OutboxWriter,
} from '@zmdb/orm/outbox';

export { withReplicas } from '@zmdb/orm/replicas';
export { type ReplicaOptions } from '@zmdb/orm/replicas';

export { makeEndpoint } from '@zmdb/web/integrations';
export { type EndpointResult, type Handler } from '@zmdb/web/integrations';

export { EventBus } from '@zmdb/orm/entity-modeling';
export { discriminatorFor, flattenEmbeddable, liftEmbeddable, rowToSubtype } from '@zmdb/schema/entity-modeling';
export { type LifecycleEvent, type Subscriber } from '@zmdb/orm/entity-modeling';
export { type SingleTableInheritance } from '@zmdb/schema/entity-modeling';

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
} from '@zmdb/orm/outbox';
