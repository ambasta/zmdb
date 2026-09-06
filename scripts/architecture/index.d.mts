import type { ProductPackage } from '../product/catalog.mjs';
import type { PackagePolicy } from './policy.mjs';

export interface ProductPackageIdentity {
  readonly id: string;
  readonly directory: string;
  readonly npmName: string;
}

export interface PackageManifest {
  readonly name?: string;
  readonly exports?: string | Readonly<Record<string, unknown>>;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly [field: string]: unknown;
}

export interface ArchitecturePackage {
  readonly id: string;
  readonly directory: string;
  readonly directoryPath: string;
  readonly npmName: string;
  readonly manifestPath: string;
  readonly catalog: ProductPackage;
  readonly policy: PackagePolicy;
  readonly manifest: PackageManifest;
}

export interface Architecture {
  readonly root: string;
  readonly catalog: readonly ProductPackage[];
  readonly policy: Readonly<Record<string, PackagePolicy>>;
  readonly packages: readonly ArchitecturePackage[];
}

export interface PackageExport {
  readonly package: ArchitecturePackage;
  readonly selector: string;
  readonly target: string;
  readonly path: string;
}

export type DependencyGraph = Readonly<Record<string, readonly string[]>>;

export class ArchitecturePolicyError extends Error {
  readonly diagnostics: readonly string[];
  constructor(diagnostics: readonly string[]);
}

export class DependencyCycleError extends Error {
  readonly cycle: readonly string[];
  constructor(cycle: readonly string[]);
}

export function policyMembershipDiagnostics(
  catalog: readonly ProductPackageIdentity[],
  policy: Readonly<Record<string, PackagePolicy>>,
): readonly string[];

export function loadArchitecture(root: string): Promise<Architecture>;

export function loadArchitectureSync(root: string): Architecture;

export function lookupPackage(architecture: Architecture, identity: string): ArchitecturePackage | undefined;

export function lookupExport(architecture: Architecture, specifier: string): PackageExport | undefined;

export function createDependencyGraph(architecture: Architecture): DependencyGraph;

export function topologicalOrder(graph: DependencyGraph): readonly string[];
