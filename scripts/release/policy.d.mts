export type ReleaseGroup = 'core' | 'integration' | 'tooling';

export interface CompatibilityRange {
  readonly range: string;
  readonly floor: string;
  readonly tested: readonly string[];
  readonly evidence: string;
}

export interface ReleasePackagePolicy {
  readonly group: ReleaseGroup;
  readonly internalCompatibility: Readonly<Record<string, CompatibilityRange>>;
  readonly peers: Readonly<Record<string, CompatibilityRange>>;
}

export const RELEASE_PACKAGE_POLICY: Readonly<Record<string, ReleasePackagePolicy>>;
