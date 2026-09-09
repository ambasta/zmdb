// The one-product import statement, compiled exactly as an application writes
// it. Each identity assertion below is against the real owning package.

import { type Module as OwnerModule, type ModuleClass as OwnerModuleClass } from '@zmdb/app';
import {
  type defineConfig as ownerDefineConfig,
  type ZmdbConfig as OwnerZmdbConfig,
} from '@zmdb/compiler/config/contract';
import {
  AssertError,
  // @ts-expect-error -- standard Stage-3 decorators have no Body parameter decorator export.
  Body as legacyBodyExport,
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
  type WebApplication,
  type CreateDTO,
  type Ctx,
  type Driver,
  type Entity,
  type HasDefault,
  type Max,
  type MaxLength,
  type Min,
  type MinLength,
  type ModuleClass,
  type Pattern,
  type Physical,
  type PrimaryKey,
  type PrimaryKeyOf,
  type ReadDTO,
  type References,
  type Sensitive,
  type Serial,
  type Sql,
  type Table,
  type Unique,
  type UpdateDTO,
  type UpdatePatch,
  type ValidateResult,
  type ValidationIssue,
  type ZmdbConfig,
} from '@zmdb/core';
import {
  type defineRepository as ownerDefineRepository,
  type IncompleteKeyError as OwnerIncompleteKeyError,
  type ValidationError as OwnerValidationError,
  type Driver as OwnerDriver,
  type UpdatePatch as OwnerUpdatePatch,
} from '@zmdb/orm';
import {
  type schemaOf as ownerSchemaOf,
  type CreateDTO as OwnerCreateDTO,
  type Entity as OwnerEntity,
  type PrimaryKeyOf as OwnerPrimaryKeyOf,
  type ReadDTO as OwnerReadDTO,
  type UpdateDTO as OwnerUpdateDTO,
} from '@zmdb/schema';
import {
  type HasDefault as OwnerHasDefault,
  type Max as OwnerMax,
  type MaxLength as OwnerMaxLength,
  type Min as OwnerMin,
  type MinLength as OwnerMinLength,
  type Pattern as OwnerPattern,
  type Physical as OwnerPhysical,
  type PrimaryKey as OwnerPrimaryKey,
  type References as OwnerReferences,
  type Sensitive as OwnerSensitive,
  type Serial as OwnerSerial,
  type Sql as OwnerSql,
  type Table as OwnerTable,
  type Unique as OwnerUnique,
} from '@zmdb/schema/tags';
import {
  type AssertError as OwnerAssertError,
  type assert as ownerAssert,
  type is as ownerIs,
  type validate as ownerValidate,
  type ValidateResult as OwnerValidateResult,
  type ValidationIssue as OwnerValidationIssue,
} from '@zmdb/validator';
import {
  type Controller as OwnerController,
  type Delete as OwnerDelete,
  type Get as OwnerGet,
  type Patch as OwnerPatch,
  type Post as OwnerPost,
  type Public as OwnerPublic,
  type Put as OwnerPut,
  type createApp as ownerCreateApp,
  type WebApplication as OwnerWebApplication,
  type Ctx as OwnerCtx,
} from '@zmdb/web';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare function legacyBodyParameter(...args: unknown[]): void;

export class Stage3BodyContract {
  handle(
    // @ts-expect-error -- standard Stage-3 decorators have no parameter position.
    @legacyBodyParameter body: unknown,
  ): unknown {
    return body;
  }
}

interface ProductRootValues {
  readonly AssertError: typeof OwnerAssertError;
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

export const stage3BodyExportProbe = legacyBodyExport;

export type _ConfigAndTags = Expect<
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
  Equal<
    [WebApplication, Ctx<{ id: string }>, ModuleClass],
    [OwnerWebApplication, OwnerCtx<{ id: string }>, OwnerModuleClass]
  >
>;

export type _Stage3BodyContract = Expect<
  Equal<Ctx<Record<never, string>, CreateDTO<FrozenOrder>>['body'], OwnerCreateDTO<FrozenOrder>>
>;
