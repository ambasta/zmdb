import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADAPTER_PACKAGES,
  adapterBrowserBoundaryProblems,
  adapterClientImplementationProblems,
  adapterManifestProblems,
  adapterQualificationProblems,
  assertSsrCredentialIsolation,
  createAngularConformanceBinding,
  createNextConformanceBinding,
  createNuxtConformanceBinding,
  createReactConformanceBinding,
  createSvelteAdapterConformanceBinding,
  createSvelteKitAdapterConformanceBinding,
  createVueConformanceBinding,
  readAdapterPackageManifest,
} from '../../../../fixtures/client-adapters/src/index.js';
import type {
  AdapterConformanceBinding,
  AdapterPackageExpectation,
  ApiClient,
} from '../../../../fixtures/client-adapters/src/index.js';
import { createSolidAdapterBinding } from '../../../../fixtures/client-adapters/src/solid-binding.js';
import { loadGovernanceSnapshot } from '../../../../scripts/architecture/governance.mjs';

const ROOT = process.cwd();
const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
if (GOVERNANCE.architecture === null) throw new Error('governance snapshot has no architecture');
const PRODUCT_CATALOG = GOVERNANCE.architecture.catalog;
const OFFICIAL_ADAPTERS = [
  '@zmdb/angular',
  '@zmdb/next',
  '@zmdb/nuxt',
  '@zmdb/react',
  '@zmdb/react-native',
  '@zmdb/solid',
  '@zmdb/svelte',
  '@zmdb/sveltekit',
  '@zmdb/vue',
] as const;

function expectationFor(name: AdapterPackageExpectation['name']): AdapterPackageExpectation {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === name);
  if (expectation === undefined) throw new Error(`missing adapter package expectation ${name}`);
  return expectation;
}

function filesUnder(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => filesUnder(join(path, entry.name)));
}

function evidenceText(expectation: AdapterPackageExpectation): string {
  return [expectation.qualification.packedTest, expectation.qualification.fixture]
    .flatMap(path => filesUnder(join(ROOT, path)))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');
}

describe('packed adapter qualification (#700)', () => {
  it('every official adapter has a real consumer fixture', () => {
    expect(ADAPTER_PACKAGES.map(expectation => expectation.name).toSorted()).toEqual(OFFICIAL_ADAPTERS);
    const catalog = PRODUCT_CATALOG.filter(row =>
      OFFICIAL_ADAPTERS.includes(row.npmName as (typeof OFFICIAL_ADAPTERS)[number]),
    );
    expect(catalog.map(row => row.npmName).toSorted()).toEqual(OFFICIAL_ADAPTERS);

    for (const expectation of ADAPTER_PACKAGES) {
      expect(existsSync(join(ROOT, expectation.qualification.fixture)), expectation.name).toBe(true);
      expect(existsSync(join(ROOT, expectation.qualification.packedTest)), expectation.name).toBe(true);
      const row = catalog.find(candidate => candidate.npmName === expectation.name);
      expect(row, expectation.name).toBeDefined();
      expect(row !== undefined && 'fixture' in row.consumer, expectation.name).toBe(true);
    }
  });

  it('every adapter uses the same generated fixture client', () => {
    const generatedClients = new Set(ADAPTER_PACKAGES.map(expectation => expectation.qualification.generatedClient));
    expect([...generatedClients]).toEqual(['fixtures/client-adapters/src/generated/api.generated.ts']);
    const canonical = readFileSync(join(ROOT, [...generatedClients][0] ?? ''), 'utf8');

    for (const expectation of ADAPTER_PACKAGES) {
      expect(evidenceText(expectation), expectation.name).toContain('api.generated.ts');
      for (const copy of expectation.qualification.generatedClientCopies ?? []) {
        expect(readFileSync(join(ROOT, copy), 'utf8'), copy).toBe(canonical);
      }
    }
  });

  it('no adapter contains URL or response-validation implementation', () => {
    for (const expectation of ADAPTER_PACKAGES) {
      expect(adapterClientImplementationProblems(ROOT, expectation), expectation.name).toEqual([]);
    }
  });

  it('framework libraries are peers', () => {
    for (const expectation of ADAPTER_PACKAGES) {
      expect(
        adapterManifestProblems(expectation, readAdapterPackageManifest(ROOT, expectation)),
        expectation.name,
      ).toEqual([]);
    }
  });

  it('meta-framework server code is absent from browser bundles', () => {
    const metaFrameworks = ADAPTER_PACKAGES.filter(expectation => expectation.qualification.kind === 'meta-framework');
    expect(metaFrameworks.map(expectation => expectation.name)).toEqual([
      '@zmdb/next',
      '@zmdb/nuxt',
      '@zmdb/sveltekit',
    ]);
    for (const expectation of metaFrameworks) {
      expect(adapterBrowserBoundaryProblems(ROOT, expectation), expectation.name).toEqual([]);
    }
  });

  it('every package satisfies its qualification criterion', () => {
    expect(
      ADAPTER_PACKAGES.filter(expectation => expectation.qualification.kind === 'base').map(
        expectation => expectation.name,
      ),
    ).toEqual(['@zmdb/react', '@zmdb/angular', '@zmdb/vue', '@zmdb/svelte', '@zmdb/solid']);
    expect(new Set(ADAPTER_PACKAGES.map(expectation => expectation.qualifyingBehaviour)).size).toBe(
      ADAPTER_PACKAGES.length,
    );
    for (const expectation of ADAPTER_PACKAGES) {
      expect(adapterQualificationProblems(ROOT, expectation), expectation.name).toEqual([]);
    }
  });

  it('every SSR adapter isolates concurrent credentials', async () => {
    const bindings = new Map<AdapterPackageExpectation['name'], AdapterConformanceBinding<ApiClient>>([
      ['@zmdb/react', createReactConformanceBinding<ApiClient>()],
      ['@zmdb/angular', createAngularConformanceBinding<ApiClient>(expectationFor('@zmdb/angular'))],
      ['@zmdb/vue', createVueConformanceBinding<ApiClient>()],
      ['@zmdb/svelte', createSvelteAdapterConformanceBinding()],
      ['@zmdb/solid', createSolidAdapterBinding<ApiClient>()],
      ['@zmdb/next', createNextConformanceBinding<ApiClient>()],
      ['@zmdb/nuxt', createNuxtConformanceBinding<ApiClient>()],
      ['@zmdb/sveltekit', createSvelteKitAdapterConformanceBinding()],
    ]);
    const ssrAdapters = ADAPTER_PACKAGES.filter(expectation => expectation.qualification.ssr);
    expect(ssrAdapters).toHaveLength(8);
    for (const expectation of ssrAdapters) {
      const binding = bindings.get(expectation.name);
      if (binding === undefined) throw new Error(`missing SSR binding for ${expectation.name}`);
      await assertSsrCredentialIsolation(binding);
    }
  });
});
