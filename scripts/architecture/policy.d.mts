export interface PackagePolicy {
  readonly directory: string;
  readonly zone: 'foundation' | 'runtime' | 'integration' | 'tooling' | 'application' | 'facade';
  readonly ring: number;
  readonly allowedWorkspaceDependencies: readonly string[];
  readonly allowedRuntimeDependencies: readonly string[];
  readonly optionalPeerEntries: Readonly<Record<string, readonly string[]>>;
  readonly toolingEntries: readonly string[];
  readonly release: 'lockstep';
}

export const PACKAGE_POLICY: Readonly<Record<string, PackagePolicy>>;
