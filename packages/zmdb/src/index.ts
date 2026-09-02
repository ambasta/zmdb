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
  PrimaryKeyOf,
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
export {
  createQueryCompiler,
  UnsupportedFeatureError,
  sanitizeKeys,
  chunkArray,
  DIALECT_PARAM_LIMITS,
} from '@zmdb/query-compiler';
export * as migrations from '@zmdb/query-compiler/migrations';
export type { Dialect, CompiledQuery } from '@zmdb/query-compiler';

// Validators (AOT). is/assert/validate live in the utilities subpath; tags at root.
//
// `AssertError` is here because a caller has to be able to catch it, and because it is the
// class the *emitted* validator throws too: the compiled path imports this exact one rather
// than declaring its own, so `catch (e) { if (e instanceof AssertError) }` keeps working
// whether or not the build inlined anything.
// `ValidationIssue` is not re-exported here: the utilities subpath re-exports schema-core's
// declaration rather than declaring a second one, and it is already above.
export { equals, is, assert, assertEquals, random, validate, AssertError } from '@zmdb/aot-validator/utilities';
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
