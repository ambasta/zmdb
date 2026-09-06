import type { Architecture } from '../../scripts/architecture/index.mjs';
import type { FacadeOwnership } from './verify-product-facade.mjs';

export interface CatalogFacade {
  readonly root?: readonly string[];
  readonly subpaths?: readonly string[];
}

export interface CatalogRow {
  readonly id?: string;
  readonly directory?: string;
  readonly npmName: string;
  readonly role?: string;
  readonly facade?: CatalogFacade;
  readonly optionality?:
    | { readonly kind: 'required' }
    | { readonly kind: 'tooling' }
    | { readonly kind: 'integration'; readonly technology: string };
  readonly docsOwner?: string;
  readonly consumer?: { readonly fixture: string } | { readonly reason: string };
}

export interface ManifestEntry {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}

export type CatalogConsumerAssignment =
  | {
      readonly npmName: string;
      readonly fixture: string;
      readonly imports: readonly string[];
    }
  | {
      readonly npmName: string;
      readonly reason: string;
      readonly gates: readonly string[];
    };

export interface CatalogConsumerReport {
  readonly assignments: readonly CatalogConsumerAssignment[];
  readonly problems: readonly string[];
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
export function catalogFacadeOwnership(rows: readonly CatalogRow[]): FacadeOwnership;
export function verifyFacadeOwnership(rows: readonly CatalogRow[], surface: FacadeOwnership): readonly string[];
export function verifyFacadeDelegation(
  root: string,
  rows: readonly CatalogRow[],
  architecture: Architecture,
): readonly string[];
export function verifyProductCatalogRows(
  rows: readonly CatalogRow[],
  manifests: ReadonlyMap<string, ManifestEntry>,
  pages: ReadonlySet<string>,
): readonly string[];
export function discoverCatalogConsumers(root: string, rows: readonly CatalogRow[]): CatalogConsumerReport;
export function handwrittenInventoryProblems(root: string, rows: readonly CatalogRow[]): readonly string[];
export function inspectProductCatalog(
  root: string | undefined,
  options: { readonly architecture: Architecture },
): Promise<ProductCatalogReport>;
