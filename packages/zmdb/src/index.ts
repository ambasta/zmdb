// zmdb umbrella — curated root re-exports of the whole ecosystem. See ./SPEC.md.
// One install (`zmdb`); the four @zmdb/* packages remain independently usable.

// Schema: DSL + column builders + modifiers + derived types.
export {
  defineSchema,
  serial,
  integer,
  bigint,
  numeric,
  text,
  varchar,
  boolean,
  timestamp,
  json,
  jsonEnum,
  notNull,
  nullable,
  primaryKey,
  unique,
  defaultTo,
  references,
  validate as validateColumn,
  sensitive,
  defineStateTransitions,
  defineEntityStateMachine,
  createStateUpdatePayload,
} from '@zmdb/schema-core';
export type {
  Entity,
  CreateDTO,
  UpdateDTO,
  CoreSchema,
  ColumnMeta,
  ValidationIssue,
  StateTransitions,
  AllowedTargetStates,
  StateUpdateDTO,
  EntityStateMachineOptions,
  EntityStateMachine,
} from '@zmdb/schema-core';

// Query compiler & Migrations.
export { createQueryCompiler, UnsupportedFeatureError } from '@zmdb/query-compiler';
export * as migrations from '@zmdb/query-compiler/migrations';
export type { Dialect, CompiledQuery } from '@zmdb/query-compiler';

// Validators (AOT). is/assert/validate live in the utilities subpath; tags at root.
export { is, assert, validate } from '@zmdb/aot-validator/utilities';
export { tags } from '@zmdb/aot-validator';

// Repository & Transactions.
export {
  BaseRepository,
  defineRepository,
  ValidationError,
  createTransactionalDb,
  batch,
  markTransactionClosed,
} from '@zmdb/repository';
export type {
  Driver,
  TransactionContext,
  TransactionState,
  ActiveTransactionContext,
  ClosedTransactionContext,
  TransactionalDb,
  TxConnection,
  UpsertOptions,
} from '@zmdb/repository';
