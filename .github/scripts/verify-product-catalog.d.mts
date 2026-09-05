import type { FacadeOwnership } from './verify-product-facade.mjs';

export interface CatalogFacade {
  readonly root?: readonly string[];
  readonly subpaths?: readonly string[];
}

export interface CatalogRow {
  readonly npmName: string;
  readonly facade?: CatalogFacade;
  readonly [field: string]: unknown;
}

export interface ManifestEntry {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}

export interface IntegrationRecord {
  readonly capability: string;
  readonly package: string | null;
  readonly status: string;
  readonly peer?: string;
  readonly docs: string;
  readonly evidence?: readonly string[];
}

export interface ProductCatalogReport {
  readonly rows: readonly CatalogRow[];
  readonly manifests: ReadonlyMap<string, ManifestEntry>;
  readonly membershipProblems: readonly string[];
  readonly facadeProblems: readonly string[];
  readonly generatedProblems: readonly string[];
  readonly consumerProblems: readonly string[];
  readonly packageReferenceBytes: string;
  readonly integrationBytes: string;
}

export const ROOT: string;

export function compareGeneratedRegion(
  source: string,
  startMarker: string,
  endMarker: string,
  expected: string,
): readonly string[];
export function renderPackageReferenceRows(
  rows: readonly CatalogRow[],
  manifests: ReadonlyMap<string, ManifestEntry>,
): string;
export function renderIntegrationRows(records: readonly IntegrationRecord[]): string;
export function verifyIntegrationRecords(
  rows: readonly CatalogRow[],
  records: readonly IntegrationRecord[],
): readonly string[];
export function verifyFacadeOwnership(rows: readonly CatalogRow[], surface: FacadeOwnership): readonly string[];
export function inspectProductCatalog(root?: string): Promise<ProductCatalogReport>;
