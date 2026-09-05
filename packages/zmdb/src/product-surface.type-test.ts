// The one-product import statement, compiled exactly as an application writes
// it. The missing names are intentionally suppressed until #620 supplies the
// facade; each identity assertion below is against the real owning package.

import type {
  AssertError as OwnerAssertError,
  assert as ownerAssert,
  is as ownerIs,
  validate as ownerValidate,
  ValidateResult as OwnerValidateResult,
} from '@zmdb/aot-validator/utilities';
import type {
  defineRepository as ownerDefineRepository,
  IncompleteKeyError as OwnerIncompleteKeyError,
  ValidationError as OwnerValidationError,
  Driver as OwnerDriver,
  UpdatePatch as OwnerUpdatePatch,
} from '@zmdb/repository';
import type {
  schemaOf as ownerSchemaOf,
  CreateDTO as OwnerCreateDTO,
  Entity as OwnerEntity,
  PrimaryKeyOf as OwnerPrimaryKeyOf,
  ReadDTO as OwnerReadDTO,
  UpdateDTO as OwnerUpdateDTO,
  ValidationIssue as OwnerValidationIssue,
} from '@zmdb/schema-core';
import type {
  HasDefault as OwnerHasDefault,
  Max as OwnerMax,
  MaxLength as OwnerMaxLength,
  Min as OwnerMin,
  MinLength as OwnerMinLength,
  Pattern as OwnerPattern,
  Physical as OwnerPhysical,
  PrimaryKey as OwnerPrimaryKey,
  References as OwnerReferences,
  Sensitive as OwnerSensitive,
  Serial as OwnerSerial,
  Sql as OwnerSql,
  Table as OwnerTable,
  Unique as OwnerUnique,
} from '@zmdb/schema-core/tags';
import type {
  Controller as OwnerController,
  Delete as OwnerDelete,
  Get as OwnerGet,
  Module as OwnerModule,
  Patch as OwnerPatch,
  Post as OwnerPost,
  Public as OwnerPublic,
  Put as OwnerPut,
  createApp as ownerCreateApp,
  App as OwnerApp,
  Ctx as OwnerCtx,
  ModuleClass as OwnerModuleClass,
} from '@zmdb/web';
import {
  AssertError,
  // @ts-expect-error -- #620 adds Body to the root facade.
  Body,
  // @ts-expect-error -- #620 adds Controller to the root facade.
  Controller,
  // @ts-expect-error -- #620 adds Delete to the root facade.
  Delete,
  // @ts-expect-error -- #620 adds Get to the root facade.
  Get,
  IncompleteKeyError,
  // @ts-expect-error -- #620 adds Module to the root facade.
  Module,
  // @ts-expect-error -- #620 adds Patch to the root facade.
  Patch,
  // @ts-expect-error -- #620 adds Post to the root facade.
  Post,
  // @ts-expect-error -- #620 adds Public to the root facade.
  Public,
  // @ts-expect-error -- #620 adds Put to the root facade.
  Put,
  ValidationError,
  assert,
  // @ts-expect-error -- #620 adds createApp to the root facade.
  createApp,
  // @ts-expect-error -- #620 adds defineConfig to the root facade.
  defineConfig,
  defineRepository,
  is,
  schemaOf,
  validate,
  // @ts-expect-error -- #620 adds App to the root facade.
  type App,
  type CreateDTO,
  // @ts-expect-error -- #620 adds Ctx to the root facade.
  type Ctx,
  type Driver,
  type Entity,
  // @ts-expect-error -- #620 adds HasDefault to the root facade.
  type HasDefault,
  // @ts-expect-error -- #620 adds Max to the root facade.
  type Max,
  // @ts-expect-error -- #620 adds MaxLength to the root facade.
  type MaxLength,
  // @ts-expect-error -- #620 adds Min to the root facade.
  type Min,
  // @ts-expect-error -- #620 adds MinLength to the root facade.
  type MinLength,
  // @ts-expect-error -- #620 adds ModuleClass to the root facade.
  type ModuleClass,
  // @ts-expect-error -- #620 adds Pattern to the root facade.
  type Pattern,
  // @ts-expect-error -- #620 adds Physical to the root facade.
  type Physical,
  // @ts-expect-error -- #620 adds PrimaryKey to the root facade.
  type PrimaryKey,
  type PrimaryKeyOf,
  // @ts-expect-error -- #620 adds ReadDTO to the root facade.
  type ReadDTO,
  // @ts-expect-error -- #620 adds References to the root facade.
  type References,
  // @ts-expect-error -- #620 adds Sensitive to the root facade.
  type Sensitive,
  // @ts-expect-error -- #620 adds Serial to the root facade.
  type Serial,
  // @ts-expect-error -- #620 adds Sql to the root facade.
  type Sql,
  // @ts-expect-error -- #620 adds Table to the root facade.
  type Table,
  // @ts-expect-error -- #620 adds Unique to the root facade.
  type Unique,
  type UpdateDTO,
  type UpdatePatch,
  type ValidateResult,
  type ValidationIssue,
  // @ts-expect-error -- #620 adds ZmdbConfig to the root facade.
  type ZmdbConfig,
} from 'zmdb';

import type { defineConfig as ownerDefineConfig, ZmdbConfig as OwnerZmdbConfig } from './config/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface ProductRootValues {
  readonly AssertError: typeof OwnerAssertError;
  readonly Body: unknown;
  readonly Controller: typeof OwnerController;
  readonly Delete: typeof OwnerDelete;
  readonly Get: typeof OwnerGet;
  readonly IncompleteKeyError: typeof OwnerIncompleteKeyError;
  readonly Module: typeof OwnerModule;
  readonly Patch: typeof OwnerPatch;
  readonly Post: typeof OwnerPost;
  readonly Public: typeof OwnerPublic;
  readonly Put: typeof OwnerPut;
  readonly ValidationError: typeof OwnerValidationError;
  readonly assert: typeof ownerAssert;
  readonly createApp: typeof ownerCreateApp;
  readonly defineConfig: typeof ownerDefineConfig;
  readonly defineRepository: typeof ownerDefineRepository;
  readonly is: typeof ownerIs;
  readonly schemaOf: typeof ownerSchemaOf;
  readonly validate: typeof ownerValidate;
}

export const productRootValues: ProductRootValues = {
  AssertError,
  Body,
  Controller,
  Delete,
  Get,
  IncompleteKeyError,
  Module,
  Patch,
  Post,
  Public,
  Put,
  ValidationError,
  assert,
  createApp,
  defineConfig,
  defineRepository,
  is,
  schemaOf,
  validate,
};

export type _ConfigAndTags = Expect<
  // @ts-expect-error -- #620 re-exports the canonical config and tag identities from the root.
  Equal<
    [
      ZmdbConfig,
      Table<'orders'>,
      Physical<'order_rows'>,
      Sql<'text'>,
      PrimaryKey,
      Serial,
      Unique,
      HasDefault,
      Sensitive,
      References<'users.id'>,
      Min<1>,
      Max<10>,
      MinLength<1>,
      MaxLength<100>,
      Pattern<'^[a-z]+$'>,
    ],
    [
      OwnerZmdbConfig,
      OwnerTable<'orders'>,
      OwnerPhysical<'order_rows'>,
      OwnerSql<'text'>,
      OwnerPrimaryKey,
      OwnerSerial,
      OwnerUnique,
      OwnerHasDefault,
      OwnerSensitive,
      OwnerReferences<'users.id'>,
      OwnerMin<1>,
      OwnerMax<10>,
      OwnerMinLength<1>,
      OwnerMaxLength<100>,
      OwnerPattern<'^[a-z]+$'>,
    ]
  >
>;

interface FrozenOrder extends OwnerTable<'orders'> {
  readonly id: number & OwnerSql<'integer'> & OwnerPrimaryKey;
  readonly secret: string & OwnerSql<'text'> & OwnerSensitive;
}

export type _SchemaTypes = Expect<
  // @ts-expect-error -- #620 adds the remaining DTO type identities to the root.
  Equal<
    [
      Entity<FrozenOrder>,
      CreateDTO<FrozenOrder>,
      UpdateDTO<FrozenOrder>,
      ReadDTO<FrozenOrder>,
      PrimaryKeyOf<FrozenOrder>,
    ],
    [
      OwnerEntity<FrozenOrder>,
      OwnerCreateDTO<FrozenOrder>,
      OwnerUpdateDTO<FrozenOrder>,
      OwnerReadDTO<FrozenOrder>,
      OwnerPrimaryKeyOf<FrozenOrder>,
    ]
  >
>;

export type _RepositoryAndValidatorTypes = Expect<
  Equal<
    [Driver, UpdatePatch<FrozenOrder>, ValidateResult<FrozenOrder>, ValidationIssue],
    [OwnerDriver, OwnerUpdatePatch<FrozenOrder>, OwnerValidateResult<FrozenOrder>, OwnerValidationIssue]
  >
>;

export type _WebTypes = Expect<
  // @ts-expect-error -- #620 adds the web application type identities to the root.
  Equal<[App, Ctx<{ id: string }>, ModuleClass], [OwnerApp, OwnerCtx<{ id: string }>, OwnerModuleClass]>
>;
