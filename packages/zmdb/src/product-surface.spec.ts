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

  it('derives every official package role and facade exposure from one product catalog', async () => {
    const report = await catalogReport();
    const jobs = PRODUCT_CATALOG.find(row => row.id === 'jobs');
    const jobsPostgres = PRODUCT_CATALOG.find(row => row.id === 'jobs-postgres');

    expect(report.membershipProblems).toEqual([]);
    expect(report.facadeProblems).toEqual([]);
    expect(report.rows).toHaveLength(report.manifests.size);
    expect(report.packageReferenceBytes).not.toBe('');
    expect(jobs?.optionality).toEqual({ kind: 'capability', capability: 'jobs' });
    expect(PRODUCT_CATALOG.find(row => row.id === 'jobs-sqlite')).toMatchObject({
      npmName: '@zmdb/jobs-sqlite',
      directory: 'packages/jobs-sqlite',
      consumer: { fixture: 'fixtures/consumer-jobs-providers' },
      optionality: {
        kind: 'provider',
        capability: 'jobs',
        capabilityOwner: 'jobs',
        technology: 'SQLite',
        includedInDefault: false,
      },
    });
    expect(jobsPostgres?.optionality).toEqual({
      kind: 'provider',
      capability: 'jobs',
      capabilityOwner: 'jobs',
      technology: 'PostgreSQL',
      includedInDefault: false,
    });
  });

  it('rejects a facade export whose owning package or visibility is absent from the catalog', () => {
    const surface = {
      root: [{ name: 'schemaOf', owner: '@zmdb/schema' }],
      subpaths: [],
    };
    expect(verifyFacadeOwnership([], surface)).toContain(
      'facade root export schemaOf owner @zmdb/schema is absent from the catalog',
    );

    const hidden = [
      {
        npmName: '@zmdb/schema',
        facade: { root: [], subpaths: [] },
      },
    ];
    expect(verifyFacadeOwnership(hidden, surface)).toContain(
      'facade root export schemaOf is absent from @zmdb/schema catalog visibility',
    );
  });

  it('rejects a package-reference or integration row that disagrees with the catalog', () => {
    const catalog = [
      {
        id: 'schema',
        directory: 'packages/schema',
        npmName: '@zmdb/schema',
        role: 'schema',
        facade: { root: ['schemaOf'], subpaths: ['zmdb/schema'] },
        optionality: { kind: 'required' },
        docsOwner: 'schema-declaration',
        consumer: { reason: 'covered by the product consumer' },
      },
    ] as const;
    const manifests = new Map([
      [
        'packages/schema',
        {
          manifest: {
            name: '@zmdb/schema',
            version: '1.0.0-alpha.4',
          },
        },
      ],
    ]);
    const releasePolicy = Object.freeze({
      schema: Object.freeze({ group: 'core' }),
    });
    const first = renderPackageReferenceRows(catalog, manifests, releasePolicy);
    const second = renderPackageReferenceRows(catalog, manifests, releasePolicy);
    expect(second).toBe(first);

    const source = [
      '# Package reference',
      '<!-- generated: product-catalog package-reference -->',
      '| stale | row |',
      '<!-- /generated: product-catalog package-reference -->',
      '',
    ].join('\n');
    expect(
      compareGeneratedRegion(
        source,
        '<!-- generated: product-catalog package-reference -->',
        '<!-- /generated: product-catalog package-reference -->',
        first,
      ),
    ).toEqual(['generated bytes disagree with canonical sources']);
    expect(source).toContain('| stale | row |');

    const records = [
      {
        capability: 'React',
        package: '@zmdb/react',
        status: 'optional',
        peers: ['react'],
        docs: 'react',
        evidence: ['fixtures/react'],
      },
    ];
    expect(renderIntegrationRows(records)).toBe(renderIntegrationRows(records));
    expect(verifyIntegrationRecords(catalog, records)).toContain(
      'integration React names uncatalogued package @zmdb/react',
    );
  });

  it('assigns every official package an external consumer or an explicit catalog reason', async () => {
    const report = await catalogReport();

    expect(report.consumerProblems).toEqual([]);
    expect(report.rows).toHaveLength(report.manifests.size);
  });

  it('accounts for every official package exactly once and rejects stale catalog rows', async () => {
    const report = await catalogReport();
    expectCliCatalogOwnership();
    expect(report.membershipProblems).toEqual([]);
    expect(report.rows.map(row => row.npmName).toSorted()).toEqual(PRODUCT_CATALOG.map(row => row.npmName).toSorted());
    expect([...report.manifests.keys()].toSorted()).toEqual(PRODUCT_CATALOG.map(row => row.directory).toSorted());

    const pages = new Set(PRODUCT_CATALOG.map(row => row.docsOwner));
    const staleManifests = new Map(report.manifests);
    const first = PRODUCT_CATALOG[0];
    if (first === undefined) throw new Error('product catalog is empty');
    staleManifests.delete(first.directory);
    expect(verifyProductCatalogRows(PRODUCT_CATALOG, staleManifests, pages)).toContain(
      `catalog package directory ${first.directory} has no manifest`,
    );

    const unregistered = new Map(report.manifests);
    unregistered.set('packages/unregistered', {
      manifest: { name: '@zmdb/unregistered' },
    });
    expect(verifyProductCatalogRows(PRODUCT_CATALOG, unregistered, pages)).toContain(
      'official package manifest packages/unregistered/package.json has no catalog row',
    );
  });

  it('derives root and subpath facade ownership from the catalog', () => {
    const actual = readFacadeOwnership(ROOT, ARCHITECTURE);
    const derived = catalogFacadeOwnership(PRODUCT_CATALOG);

    expect(derived.root).toHaveLength(89);
    expect(derived.subpaths).toHaveLength(52);
    expect(actual.root).toEqual(derived.root);
    expect(actual.subpaths.map(item => item.name)).toEqual(derived.subpaths.map(item => item.name));
    expect(verifyFacadeOwnership(PRODUCT_CATALOG, actual)).toEqual([]);
    expect(verifyFacadeDelegation(ROOT, PRODUCT_CATALOG, ARCHITECTURE)).toEqual([]);
  });

  it('generates package-reference and support-matrix rows without a handwritten package list', async () => {
    const report = await catalogReport();
    expect(report.generatedProblems).toEqual([]);
    expect(report.packageReferenceBytes).toContain('@zmdb/schema');
    const jobsRow = report.packageReferenceBytes.split('\n').find(line => line.startsWith('| @zmdb/jobs '));
    expect(jobsRow).toContain('`npm add @zmdb/jobs@1.0.0-alpha.4`');
    expect(jobsRow).not.toContain('npm add zmdb');
    expect(report.packageReferenceBytes).toMatch(/\|\s+zmdb\s+\|/);
    expect(handwrittenInventoryProblems(ROOT, PRODUCT_CATALOG)).toEqual([]);

    const records = [
      {
        capability: 'Vercel AI SDK',
        package: '@zmdb/ai-vercel',
        status: 'optional',
        peers: ['ai'],
        docs: 'llm-vercel-ai-sdk',
        evidence: ['fixtures/llm-adapters'],
      },
    ];
    expect(verifyIntegrationRecords(PRODUCT_CATALOG, records)).toEqual([]);
    expect(renderIntegrationRows(records)).toContain('Vercel AI SDK');
    expect(renderIntegrationRows(records)).toContain('@zmdb/ai-vercel');
  });

  it('discovers every packed external consumer from its catalog owner', () => {
    const report = discoverCatalogConsumers(ROOT, PRODUCT_CATALOG);

    expectCliCatalogOwnership();
    expect(report.problems).toEqual([]);
    expect(report.assignments.map(assignment => assignment.npmName).toSorted()).toEqual(
      PRODUCT_CATALOG.map(row => row.npmName).toSorted(),
    );
    for (const kind of ['fixture', 'reason'] as const)
      expect(
        report.assignments
          .filter(assignment => kind in assignment)
          .map(assignment => assignment.npmName)
          .toSorted(),
      ).toEqual(
        PRODUCT_CATALOG.filter(row => kind in row.consumer)
          .map(row => row.npmName)
          .toSorted(),
      );
  });

  it('rejects an undocumented package, duplicate public role, or facade export with no owner', async () => {
    const report = await catalogReport();
    const pages = new Set(PRODUCT_CATALOG.map(row => row.docsOwner));
    const first = PRODUCT_CATALOG[0];
    const second = PRODUCT_CATALOG[1];
    if (first === undefined || second === undefined) throw new Error('product catalog needs two rows');

    const undocumented = Object.freeze(
      PRODUCT_CATALOG.map(row => (row === first ? Object.freeze({ ...row, docsOwner: 'missing-page' }) : row)),
    );
    expect(verifyProductCatalogRows(undocumented, report.manifests, pages)).toContain(
      `catalog package ${first.npmName} docs owner missing-page is absent from the page registry`,
    );

    const duplicateRole = Object.freeze(
      PRODUCT_CATALOG.map(row => (row === second ? Object.freeze({ ...row, role: first.role }) : row)),
    );
    expect(verifyProductCatalogRows(duplicateRole, report.manifests, pages)).toContain(
      `duplicate catalog role ${first.role}`,
    );

    expect(
      verifyFacadeOwnership(PRODUCT_CATALOG, {
        root: [{ name: 'orphanedFacadeExport', owner: '@zmdb/missing' }],
        subpaths: [],
      }),
    ).toContain('facade root export orphanedFacadeExport owner @zmdb/missing is absent from the catalog');

    const providerWithoutOwner = Object.freeze(
      PRODUCT_CATALOG.map(row =>
        row.id === 'jobs-postgres'
          ? Object.freeze({
              ...row,
              optionality: Object.freeze({
                ...row.optionality,
                capabilityOwner: 'missing',
              }),
            })
          : row,
      ),
    );
    expect(verifyProductCatalogRows(providerWithoutOwner, report.manifests, pages)).toContain(
      'catalog provider jobs-postgres names invalid capability owner missing for jobs',
    );

    const providerWithFalseDefaultClaim = Object.freeze(
      PRODUCT_CATALOG.map(row =>
        row.id === 'jobs-postgres'
          ? Object.freeze({
              ...row,
              optionality: Object.freeze({
                ...row.optionality,
                includedInDefault: true,
              }),
            })
          : row,
      ),
    );
    expect(verifyProductCatalogRows(providerWithFalseDefaultClaim, report.manifests, pages)).toContain(
      'catalog provider jobs-postgres includedInDefault true disagrees with installed zmdb production closure false',
    );
  });

  it('exposes package membership to release governance without encoding versions or publish actions', () => {
    const releaseFields = [
      'changelog',
      'credentials',
      'distTag',
      'npmTag',
      'publish',
      'publishOrder',
      'releaseNotes',
      'tag',
      'version',
    ];

    expect(PRODUCT_CATALOG.map(row => row.id)).toEqual(PRODUCT_CATALOG.map(row => row.id).toSorted());
    for (const row of PRODUCT_CATALOG) {
      expect(Object.keys(row).toSorted()).toEqual([
        'consumer',
        'directory',
        'docsOwner',
        'facade',
        'id',
        'npmName',
        'optionality',
        'role',
      ]);
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.facade)).toBe(true);
      expect(Object.isFrozen(row.facade.root)).toBe(true);
      expect(Object.isFrozen(row.facade.subpaths)).toBe(true);
      expect(Object.isFrozen(row.optionality)).toBe(true);
      expect(Object.isFrozen(row.consumer)).toBe(true);
      for (const field of releaseFields) expect(Object.hasOwn(row, field)).toBe(false);
    }
    expect(Reflect.set(PRODUCT_CATALOG[0] ?? {}, 'version', '9.9.9')).toBe(false);
  });
});
