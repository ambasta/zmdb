import type { Architecture } from '../../scripts/architecture/index.mjs';

export interface CoreServerPackageTarget {
  readonly name: '@zmdb/app' | '@zmdb/web' | '@zmdb/jobs';
  readonly dir: 'app' | 'web' | 'jobs';
  readonly dependencies: Readonly<Record<string, 'workspace:^'>>;
  readonly exports: readonly string[];
  readonly buildTimeExports?: readonly string[];
  readonly forbiddenPackages: readonly string[];
  readonly forbiddenExports: readonly string[];
}

export const CORE_SERVER_PACKAGES: readonly CoreServerPackageTarget[];
export const PRODUCT_SERVER_EXPORTS: readonly string[];

export interface CoreServerBoundaryReport {
  readonly packageProblems: ReadonlyMap<string, readonly string[]>;
  readonly edges: readonly (readonly [string, string])[];
  readonly graphProblems: readonly string[];
}

export function findServerPackageCycle(edges: readonly (readonly [string, string])[]): readonly string[] | null;
export function analyzeAppKernelBoundary(
  root: string | undefined,
  options: { readonly architecture: Architecture },
): readonly string[];
export function analyzeCoreServerBoundaries(
  root: string | undefined,
  options: { readonly architecture: Architecture; readonly requireAll?: boolean },
): CoreServerBoundaryReport;
export function analyzeOptionalServerPackages(
  root: string | undefined,
  options: { readonly architecture: Architecture; readonly requireAll?: boolean },
): readonly string[];
export function analyzeServerBoundaries(
  root: string | undefined,
  options: { readonly architecture: Architecture; readonly requireAll?: boolean },
): readonly string[];
