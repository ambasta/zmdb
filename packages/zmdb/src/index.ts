// The application-facing zmdb vocabulary. This file is deliberately only
// named re-exports: implementations remain in their owning packages, while
// advanced surfaces live under concern-based `@zmdb/core/*` entry points.

export {
  AssertError,
  assert,
  assertShallow,
  assertEquals,
  equals,
  is,
  isShallow,
  makeRng,
  validate,
  validateShallow,
} from '@zmdb/validator';
export type { ValidateResult } from '@zmdb/validator';

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

export { defineRepository, IncompleteKeyError, ValidationError } from '@zmdb/orm';
export { type Driver, type UpdatePatch } from '@zmdb/orm';

export {
  createStateUpdatePayload,
  decodeValue,
  defineEntityStateMachine,
  defineStateTransitions,
  defineType,
  encodeValue,
  schemaOf,
} from '@zmdb/schema';
export type {
  AllowedTargetStates,
  CreateDTO,
  CustomType,
  Entity,
  EntityStateMachine,
  EntityStateMachineOptions,
  PrimaryKeyOf,
  ReadDTO,
  StateTransitions,
  StateUpdateDTO,
  UpdateDTO,
} from '@zmdb/schema';
export { type ValidationIssue } from '@zmdb/validator';
export type {
  HasDefault,
  Max,
  MaxLength,
  Min,
  MinLength,
  Pattern,
  Physical,
  PrimaryKey,
  References,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
} from '@zmdb/schema/tags';

export { createApp } from '@zmdb/web/app';
export type { WebApplication, WebApplicationOptions } from '@zmdb/web/app';
export type { Ctx } from '@zmdb/web/context';
export { Gateway, Subscribe } from '@zmdb/web/gateways';
export type { WebRequest, WebResponse } from '@zmdb/web/pipeline';
export { Controller, Delete, Get, Patch, Post, Public, Put } from '@zmdb/web/routing';
export { Version, VersionNeutral } from '@zmdb/web/versioning';

export { defineConfig } from '@zmdb/compiler/config/contract';
export type { ZmdbConfig } from '@zmdb/compiler/config/contract';
