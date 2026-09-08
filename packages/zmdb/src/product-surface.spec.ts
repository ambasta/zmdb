import { Module as ownerModule } from '@zmdb/app/modules';
import { defineConfig as ownerDefineConfig } from '@zmdb/compiler/config/contract';
import {
  IncompleteKeyError as ownerIncompleteKeyError,
  ValidationError as ownerValidationError,
  defineRepository as ownerDefineRepository,
} from '@zmdb/orm';
import { schemaOf as ownerSchemaOf } from '@zmdb/schema';
import {
  AssertError as ownerAssertError,
  assert as ownerAssert,
  is as ownerIs,
  validate as ownerValidate,
} from '@zmdb/validator';
import { createApp as ownerCreateApp } from '@zmdb/web/app';
import {
  Controller as ownerController,
  Delete as ownerDelete,
  Get as ownerGet,
  Patch as ownerPatch,
  Post as ownerPost,
  Public as ownerPublic,
  Put as ownerPut,
} from '@zmdb/web/routing';
import { describe, expect, it } from 'vitest';

import { inspectProductFacade, TARGET_ROOT_VALUES } from '../../../.github/scripts/verify-product-facade.mjs';
import {
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
} from './index.js';

let measuredFacade: ReturnType<typeof inspectProductFacade> | undefined;
function facadeReport(): ReturnType<typeof inspectProductFacade> {
  measuredFacade ??= inspectProductFacade(process.cwd());
  return measuredFacade;
}

describe('product facade runtime identities', () => {
  it('imports the complete application surface from @zmdb/core without internal package imports', () => {
    const report = facadeReport();

    expect(report.processProblems).toEqual([]);
    expect(report.runtimeNames).toEqual(TARGET_ROOT_VALUES);
    expect(report.missingSubpaths).toEqual([]);
  }, 15_000);

  it('does not reach tooling or optional integrations when the @zmdb/core root is imported', () => {
    const report = facadeReport();

    expect(report.processProblems).toEqual([]);
    expect(report.forbiddenImports).toEqual([]);
  });

  it('exports every root symbol with the same runtime identity as its owning package', () => {
    expect({
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
    }).toEqual({
      AssertError: ownerAssertError,
      Controller: ownerController,
      Delete: ownerDelete,
      Get: ownerGet,
      IncompleteKeyError: ownerIncompleteKeyError,
      Module: ownerModule,
      Patch: ownerPatch,
      Post: ownerPost,
      Public: ownerPublic,
      Put: ownerPut,
      ValidationError: ownerValidationError,
      assert: ownerAssert,
      createApp: ownerCreateApp,
      defineConfig: ownerDefineConfig,
      defineRepository: ownerDefineRepository,
      is: ownerIs,
      schemaOf: ownerSchemaOf,
      validate: ownerValidate,
    });
  });

  it('preserves every concern-facade runtime identity', async () => {
    const cases = [
      {
        facade: '@zmdb/core/schema',
        owners: [
          '@zmdb/schema',
          '@zmdb/schema/dto',
          '@zmdb/schema/ir',
          '@zmdb/schema/openapi',
          '@zmdb/schema/custom-types',
          '@zmdb/schema/naming',
        ],
        excluded: new Set([
          'TAG_NAMES',
          'ValidationError',
          'discriminantOf',
          'expectedForConstraint',
          'expectedForDiscriminant',
          'expectedOf',
          'hasExcessCheck',
          'messageFor',
          'singularPascalCase',
        ]),
      },
      {
        facade: '@zmdb/core/sql',
        owners: [
          '@zmdb/sql',
          '@zmdb/sql/fts',
          '@zmdb/sql/joins',
          '@zmdb/sql/aggregations',
          '@zmdb/sql/set-ops',
          '@zmdb/sql/schema-objects',
          '@zmdb/schema/naming',
        ],
        excluded: new Set([
          'DIALECT_PARAM_LIMITS',
          'chunkArray',
          'sanitizeKeys',
          'resolveNaming',
          'snakeCase',
          'snakeCasePlural',
        ]),
      },
      {
        facade: '@zmdb/core/validator',
        owners: ['@zmdb/validator', '@zmdb/validator', '@zmdb/validator/advanced', '@zmdb/validator/serialization'],
        excluded: new Set(['validate', 'claimsValidationIssues', 'validationIssuesOf', 'validateRule']),
      },
      {
        facade: '@zmdb/core/orm',
        owners: [
          '@zmdb/orm',
          '@zmdb/orm/seeding',
          '@zmdb/orm/outbox',
          '@zmdb/orm/replicas',
          '@zmdb/web/integrations',
          '@zmdb/orm/entity-modeling',
          '@zmdb/orm/outbox',
        ],
        excluded: new Set<string>(),
      },
      {
        facade: '@zmdb/core/compiler',
        owners: [
          '@zmdb/compiler',
          '@zmdb/compiler/emit',
          '@zmdb/compiler/lint',
          '@zmdb/compiler/reflect',
          '@zmdb/compiler/transform',
          '@zmdb/compiler/unplugin',
        ],
        excluded: new Set(['default', 'zmdbAot']),
      },
      {
        facade: '@zmdb/core/migrations',
        owners: ['@zmdb/migrations', '@zmdb/migrations/embedded', '@zmdb/migrations/introspect'],
        excluded: new Set([
          'action',
          'deterministicForeignKeyName',
          'flagField',
          'integerField',
          'normalizeDriftSnapshot',
          'nullableTextField',
          'query',
          'sortByName',
          'sortWarnings',
          'splitSqlList',
          'tableSelected',
          'textField',
        ]),
      },
      {
        facade: '@zmdb/core/testing',
        owners: ['@zmdb/compiler/testing', '@zmdb/web/testing'],
        excluded: new Set<string>(),
      },
    ] as const;

    for (const { facade, owners, excluded } of cases) {
      const product: Readonly<Record<string, unknown>> = await import(facade);
      for (const ownerSpecifier of owners) {
        const owner: Readonly<Record<string, unknown>> = await import(ownerSpecifier);
        for (const [name, value] of Object.entries(owner)) {
          if (excluded.has(name)) continue;
          expect(product[name], `${facade} must preserve ${ownerSpecifier}#${name}`).toBe(value);
        }
      }
    }

    for (const [facade, ownerSpecifier, names] of [
      ['@zmdb/core/schema', '@zmdb/validator', ['ValidationError', 'claimsValidationIssues', 'validationIssuesOf']],
      ['@zmdb/core/schema', '@zmdb/orm/dto', ['applyKeysetFilter', 'applyOrderBy', 'applyPagination', 'compileWhere']],
      ['@zmdb/core/schema', '@zmdb/orm/relations', ['aliasRow', 'attachPopulated', 'compilePopulate']],
      [
        '@zmdb/core/schema',
        '@zmdb/app',
        ['createStateUpdatePayload', 'defineEntityStateMachine', 'defineStateTransitions'],
      ],
      [
        '@zmdb/core/orm',
        '@zmdb/schema/entity-modeling',
        ['discriminatorFor', 'flattenEmbeddable', 'liftEmbeddable', 'rowToSubtype'],
      ],
    ] as const) {
      const product: Readonly<Record<string, unknown>> = await import(facade);
      const owner: Readonly<Record<string, unknown>> = await import(ownerSpecifier);
      for (const name of names) {
        expect(product[name], `${facade} must preserve ${ownerSpecifier}#${name}`).toBe(owner[name]);
      }
    }

    const orm: Readonly<Record<string, unknown>> = await import('@zmdb/core/orm');
    expect(orm).not.toHaveProperty('jobPendingIndexDdl');

    const validator: Readonly<Record<string, unknown>> = await import('@zmdb/core/validator');
    const utilities: Readonly<Record<string, unknown>> = await import('@zmdb/validator');
    const compiler: Readonly<Record<string, unknown>> = await import('@zmdb/core/compiler');
    const lint: Readonly<Record<string, unknown>> = await import('@zmdb/compiler/lint');
    const productCompiler: Readonly<Record<string, unknown>> = await import('@zmdb/compiler');
    expect(compiler.lintPlugin).toBe(lint.default);
    expect(compiler.zmdbAot).toBe(productCompiler.zmdbAot);
    expect(validator.validate).toBe(utilities.validate);
  });
});
