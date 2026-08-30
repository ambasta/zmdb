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
} from '@zmdb/schema-core';
export type { Entity, CreateDTO, UpdateDTO, CoreSchema, ColumnMeta } from '@zmdb/schema-core';

// Query compiler.
export { createQueryCompiler } from '@zmdb/query-compiler';
export type { Dialect, CompiledQuery } from '@zmdb/query-compiler';

// Validators (AOT). is/assert/validate live in the utilities subpath; tags at root.
export { is, assert, validate } from '@zmdb/aot-validator/utilities';
export { tags } from '@zmdb/aot-validator';

// Repository.
export { BaseRepository, defineRepository, ValidationError } from '@zmdb/repository';
export type { Driver } from '@zmdb/repository';
