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
  defineType,
  encodeValue,
  decodeValue,
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
  CustomType,
} from '@zmdb/schema-core';

// Query compiler & Migrations.
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
export * as migrations from '@zmdb/query-compiler/migrations';
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
