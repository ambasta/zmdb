// zmdb umbrella — curated root re-exports of the whole ecosystem. See ./SPEC.md.
// One install (`zmdb`); the four @zmdb/* packages remain independently usable.

// Schema: the generated schema value, the state machine, and the derived types.
//
// There is no column-builder surface to re-export any more. A schema is a tagged interface
// — `zmdb/tags` is the vocabulary — and `schemaOf<T>()` is what turns one into the value the
// query compiler reads.
export {
  schemaOf,
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
  TaggedSchema,
  ColumnMeta,
  ValidationIssue,
  StateTransitions,
  AllowedTargetStates,
  StateUpdateDTO,
  EntityStateMachineOptions,
  EntityStateMachine,
} from '@zmdb/schema-core';

// Query compiler. Schema lifecycle tooling is intentionally available only
// from `zmdb/migrations`, so importing the product root cannot pull a
// filesystem or formatter into an application runtime.
export {
  appendComment,
  coalesce,
  concat,
  serializeComment,
  withComments,
  createQueryCompiler,
  dec,
  inc,
  mul,
  not,
  proposed,
  UnsupportedFeatureError,
  sanitizeKeys,
  chunkArray,
  DIALECT_PARAM_LIMITS,
} from '@zmdb/query-compiler';
export type {
  ColumnExpr,
  CommentKey,
  CommentKeys,
  CommentPairs,
  CompiledQuery,
  Dialect,
  SetValue,
} from '@zmdb/query-compiler';

// Validators (AOT). is/assert/validate live in the utilities subpath; tags at root.
//
// `AssertError` is here because a caller has to be able to catch it, and because it is the
// class the *emitted* validator throws too: the compiled path imports this exact one rather
// than declaring its own, so `catch (e) { if (e instanceof AssertError) }` keeps working
// whether or not the build inlined anything.
// `ValidationIssue` is not re-exported here: the utilities subpath re-exports schema-core's
// declaration rather than declaring a second one, and it is already above.
export {
  equals,
  is,
  isShallow,
  assert,
  assertShallow,
  assertEquals,
  random,
  validate,
  validateShallow,
  AssertError,
} from '@zmdb/aot-validator/utilities';
export type { ValidateResult } from '@zmdb/aot-validator/utilities';
export { tags } from '@zmdb/aot-validator';

// The type-first pair, from the OpenAPI subpath because that is where the JSON Schema
// vocabulary lives. `toJsonSchema<T>()` and `toJsonSchema(schema)` are one overloaded
// function, so there is nothing to choose between here — installing `zmdb` gets both.
export { toJsonSchema } from '@zmdb/schema-core/openapi';
export type { JsonSchemaObject } from '@zmdb/schema-core/openapi';

// Repository & Transactions.
export {
  BaseRepository,
  defineRepository,
  IncompleteKeyError,
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
  NumericColumnOf,
  UpdatePatch,
  UpsertOptions,
} from '@zmdb/repository';

// Application kernel. The product root carries the one-call application
// vocabulary; the complete concern surfaces remain under `zmdb/app/*`.
export { Container, Inject, Module, createApplication, createToken } from '@zmdb/app';
export type {
  Application,
  ApplicationExtension,
  ApplicationExtensionContext,
  ApplicationOptions,
  ModuleClass,
  Token,
} from '@zmdb/app';
export { Command, createCommandApp } from '@zmdb/app/commands';
export type { CommandApp } from '@zmdb/app/commands';
export { repositoryToken } from '@zmdb/app/data';
export { OnEvent, createEvents } from '@zmdb/app/events';
export { EventPattern, MessagePattern } from '@zmdb/app/messaging';
export type { TransportStrategy } from '@zmdb/app/messaging';
export type { Observability } from '@zmdb/app/observability';

// HTTP. @zmdb/web stays HTTP-only; these are direct identities from that
// package, composed with the application kernel only at the product facade.
export { Controller, Delete, Get, Patch, Post, Public, Put } from '@zmdb/web/routing';
export { Gateway, Subscribe } from '@zmdb/web/gateways';
export { Version, VersionNeutral } from '@zmdb/web/versioning';
export { createApp } from '@zmdb/web/app';
export type { WebApplication, WebApplicationOptions } from '@zmdb/web/app';
export type { Ctx } from '@zmdb/web/context';
export type { WebRequest, WebResponse } from '@zmdb/web/pipeline';

// Background work. Optional durable stores remain independently selected;
// the default product includes only the built-in SQLite memory path.
export { Cron, Interval, createMemoryJobStore, createQueue, createScheduler, createWorker } from '@zmdb/jobs';
export type { MemoryJobStore, Queue, Scheduler, Worker } from '@zmdb/jobs';
