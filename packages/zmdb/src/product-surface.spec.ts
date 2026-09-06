import { join } from 'node:path';

import {
  AssertError as ownerAssertError,
  assert as ownerAssert,
  is as ownerIs,
  validate as ownerValidate,
} from '@zmdb/aot-validator/utilities';
import { Module as ownerModule } from '@zmdb/app/modules';
import {
  IncompleteKeyError as ownerIncompleteKeyError,
  ValidationError as ownerValidationError,
  defineRepository as ownerDefineRepository,
} from '@zmdb/repository';
import { schemaOf as ownerSchemaOf } from '@zmdb/schema-core';
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

import {
  catalogFacadeOwnership,
  compareGeneratedRegion,
  discoverCatalogConsumers,
  handwrittenInventoryProblems,
  inspectProductCatalog,
  renderIntegrationRows,
  renderPackageReferenceRows,
  verifyFacadeDelegation,
  verifyFacadeOwnership,
  verifyIntegrationRecords,
  verifyProductCatalogRows,
} from '../../../.github/scripts/verify-product-catalog.mjs';
import {
  REQUIRED_PRODUCT_SUBPATHS,
  TARGET_ROOT_TYPES,
  TARGET_ROOT_VALUES,
  inspectProductConsumerFixture,
  inspectProductFacade,
  readFacadeOwnership,
  runPackedProductConsumer,
  verifyFacadeSource,
} from '../../../.github/scripts/verify-product-facade.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  withPackedBuildLock,
} from '../../../fixtures/client-adapters/src/packed-project.js';
import { PRODUCT_CATALOG } from '../../../scripts/product/catalog.mjs';
import { defineConfig as ownerDefineConfig } from './config/contract.js';
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

const ROOT = process.cwd();
const PRODUCT_FIXTURE = join(ROOT, 'fixtures', 'consumer-product');

let measuredFacade: ReturnType<typeof inspectProductFacade> | undefined;
function facadeReport(): ReturnType<typeof inspectProductFacade> {
  measuredFacade ??= inspectProductFacade(ROOT);
  return measuredFacade;
}

let measuredCatalog: ReturnType<typeof inspectProductCatalog> | undefined;
function catalogReport(): ReturnType<typeof inspectProductCatalog> {
  measuredCatalog ??= inspectProductCatalog(ROOT);
  return measuredCatalog;
}

let measuredPacked: ReturnType<typeof runPackedProductConsumer> | undefined;
function packedReport(): ReturnType<typeof runPackedProductConsumer> {
  measuredPacked ??= withPackedBuildLock(ROOT, () => runPackedProductConsumer(ROOT, PRODUCT_FIXTURE));
  return measuredPacked;
}

function expectPackedProductJourney(): void {
  expect(inspectProductConsumerFixture(PRODUCT_FIXTURE)).toEqual([]);

  const result = packedReport();
  expect(result.status, `${result.stage}\n${result.stdout}\n${result.stderr}`).toBe(0);
  const output: unknown = JSON.parse(result.stdout.trim());
  expect(output).toMatchObject({
    applied: [20260905000100],
    invalidStatus: 400,
    afterInvalid: { count: 0 },
    created: { id: 1, name: 'first order' },
    ledger: [
      {
        version: 20260905000100,
        name: 'create_orders',
        checksum: 'sha256:consumer-product-create-orders-v1',
      },
    ],
    stored: [{ id: 1, name: 'first order' }],
  });
}

describe('the one-product facade and catalog (#619, #620, #622)', () => {
  it('imports the complete application surface from zmdb without internal package imports', () => {
    const report = facadeReport();

    expect(report.processProblems).toEqual([]);
    expect(report.runtimeNames).toEqual(TARGET_ROOT_VALUES);
    expect(report.typeNames).toEqual(TARGET_ROOT_TYPES);
    expect(report.missingSubpaths).toEqual([]);
    expect(report.facadeImplementationProblems).toEqual([]);
    expect(REQUIRED_PRODUCT_SUBPATHS).toHaveLength(44);
  });

  // The migration namespace is reachable only through `zmdb/migrations`, so
  // importing the application root loads neither tooling nor optional peers.
  it('does not reach tooling or optional integrations when the zmdb root is imported', () => {
    const report = facadeReport();

    expect(report.processProblems).toEqual([]);
    expect(report.forbiddenImports).toEqual([]);
  });

  it('keeps the root facade free of executable implementation logic', () => {
    expect(verifyFacadeSource("export { schemaOf } from '@zmdb/schema-core';", 'clean facade')).toEqual([]);
    expect(verifyFacadeSource("export * as schema from '@zmdb/schema-core';", 'wildcard facade')).toEqual([
      "wildcard facade contains executable or non-delegating source: export * as schema from '@zmdb/schema-core';",
    ]);
    expect(verifyFacadeSource('export const cache = new Map();', 'planted facade')).toEqual([
      'planted facade contains executable or non-delegating source: export const cache = new Map();',
    ]);
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
        facade: 'zmdb/schema',
        owners: [
          '@zmdb/schema-core',
          '@zmdb/schema-core/dto',
          '@zmdb/schema-core/ir',
          '@zmdb/schema-core/openapi',
          '@zmdb/schema-core/custom-types',
          '@zmdb/schema-core/naming',
        ],
        excluded: new Set(['TAG_NAMES']),
      },
      {
        facade: 'zmdb/sql',
        owners: [
          '@zmdb/query-compiler',
          '@zmdb/query-compiler/fts',
          '@zmdb/query-compiler/joins',
          '@zmdb/query-compiler/aggregations',
          '@zmdb/query-compiler/set-ops',
          '@zmdb/query-compiler/schema-objects',
          '@zmdb/query-compiler/naming',
        ],
        excluded: new Set(['DIALECT_PARAM_LIMITS', 'chunkArray', 'sanitizeKeys']),
      },
      {
        facade: 'zmdb/validator',
        owners: [
          '@zmdb/aot-validator',
          '@zmdb/aot-validator/utilities',
          '@zmdb/aot-validator/advanced',
          '@zmdb/aot-validator/serialization',
        ],
        excluded: new Set(['validate']),
      },
      {
        facade: 'zmdb/orm',
        owners: [
          '@zmdb/repository',
          '@zmdb/repository/seeding',
          '@zmdb/repository/outbox',
          '@zmdb/repository/replicas',
          '@zmdb/repository/integrations',
          '@zmdb/repository/entity-modeling',
          '@zmdb/repository/jobs',
          '@zmdb/query-compiler/outbox',
        ],
        excluded: new Set<string>(),
      },
      {
        facade: 'zmdb/compiler',
        owners: [
          '@zmdb/aot-validator/unplugin',
          '@zmdb/aot-validator/metro',
          '@zmdb/aot-validator/codegen',
          '@zmdb/aot-validator/emit',
          '@zmdb/aot-validator/reflect',
          '@zmdb/aot-validator/transformer',
        ],
        excluded: new Set(['zmdbAot']),
      },
      {
        facade: 'zmdb/migrations',
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
        facade: 'zmdb/testing',
        owners: ['@zmdb/aot-validator/testing', '@zmdb/web/testing'],
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

    const compiler: Readonly<Record<string, unknown>> = await import('zmdb/compiler');
    const lint: Readonly<Record<string, unknown>> = await import('@zmdb/aot-validator/lint');
    const productCompiler: Readonly<Record<string, unknown>> = await import('./unplugin.js');
    const validator: Readonly<Record<string, unknown>> = await import('zmdb/validator');
    const utilities: Readonly<Record<string, unknown>> = await import('@zmdb/aot-validator/utilities');
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
      root: [{ name: 'schemaOf', owner: '@zmdb/schema-core' }],
      subpaths: [],
    };
    expect(verifyFacadeOwnership([], surface)).toContain(
      'facade root export schemaOf owner @zmdb/schema-core is absent from the catalog',
    );

    const hidden = [
      {
        npmName: '@zmdb/schema-core',
        facade: { root: [], subpaths: [] },
      },
    ];
    expect(verifyFacadeOwnership(hidden, surface)).toContain(
      'facade root export schemaOf is absent from @zmdb/schema-core catalog visibility',
    );
  });

  it('rejects a package-reference or integration row that disagrees with the catalog', () => {
    const catalog = [
      {
        id: 'schema',
        directory: 'packages/schema-core',
        npmName: '@zmdb/schema-core',
        role: 'schema',
        facade: { root: ['schemaOf'], subpaths: ['zmdb/schema'] },
        optionality: { kind: 'required' },
        docsOwner: 'schema-declaration',
        consumer: { reason: 'covered by the product consumer' },
      },
    ] as const;
    const manifests = new Map([
      [
        'packages/schema-core',
        {
          manifest: {
            name: '@zmdb/schema-core',
            version: '1.0.0-alpha.4',
          },
        },
      ],
    ]);
    const first = renderPackageReferenceRows(catalog, manifests);
    const second = renderPackageReferenceRows(catalog, manifests);
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
    expect(report.membershipProblems).toEqual([]);
    expect(report.rows).toHaveLength(37);
    expect(report.manifests.size).toBe(37);

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
    const actual = readFacadeOwnership(ROOT);
    const derived = catalogFacadeOwnership(PRODUCT_CATALOG);

    expect(derived.root).toHaveLength(71);
    expect(derived.subpaths).toHaveLength(50);
    expect(actual.root).toEqual(derived.root);
    expect(actual.subpaths.map(item => item.name)).toEqual(derived.subpaths.map(item => item.name));
    expect(verifyFacadeOwnership(PRODUCT_CATALOG, actual)).toEqual([]);
    expect(verifyFacadeDelegation(ROOT, PRODUCT_CATALOG)).toEqual([]);
  });

  it('generates package-reference and support-matrix rows without a handwritten package list', async () => {
    const report = await catalogReport();
    expect(report.generatedProblems).toEqual([]);
    expect(report.packageReferenceBytes).toContain('@zmdb/schema-core');
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

    expect(report.problems).toEqual([]);
    expect(report.assignments).toHaveLength(37);
    expect(report.assignments.filter(assignment => 'fixture' in assignment)).toHaveLength(28);
    expect(report.assignments.filter(assignment => 'reason' in assignment)).toHaveLength(9);
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

  // The fixture itself is a real external project: one registry dependency,
  // no workspace protocol, no paths, no skipLibCheck and no @zmdb/* import.
  it(
    'installs only zmdb and serves a validated SQLite-backed HTTP request from packed tarballs',
    () => {
      expectPackedProductJourney();
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'builds the documented application using only the zmdb root and documented subpaths',
    () => {
      expectPackedProductJourney();
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
