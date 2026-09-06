// The application-facing zmdb vocabulary. This file is deliberately only
// named re-exports: implementations remain in their owning packages, while
// advanced surfaces live under concern-based `zmdb/*` entry points.

export { AssertError, assert, is, validate } from '@zmdb/aot-validator/utilities';
export type { ValidateResult } from '@zmdb/aot-validator/utilities';

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

export { defineRepository, IncompleteKeyError, ValidationError } from '@zmdb/repository';
export type { Driver, UpdatePatch } from '@zmdb/repository';

export { schemaOf } from '@zmdb/schema-core';
export type { CreateDTO, Entity, PrimaryKeyOf, ReadDTO, UpdateDTO, ValidationIssue } from '@zmdb/schema-core';
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
} from '@zmdb/schema-core/tags';

export { createApp } from '@zmdb/web/app';
export type { WebApplication, WebApplicationOptions } from '@zmdb/web/app';
export type { Ctx } from '@zmdb/web/context';
export { Gateway, Subscribe } from '@zmdb/web/gateways';
export type { WebRequest, WebResponse } from '@zmdb/web/pipeline';
export { Controller, Delete, Get, Patch, Post, Public, Put } from '@zmdb/web/routing';
export { Version, VersionNeutral } from '@zmdb/web/versioning';

export { defineConfig } from './config/contract.js';
export type { ZmdbConfig } from './config/contract.js';
