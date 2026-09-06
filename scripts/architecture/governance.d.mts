import type { Architecture, ArchitecturePackage } from './index.mjs';

export interface GovernanceFinding {
  readonly id: string;
  readonly code: string;
  readonly scope: {
    readonly kind: 'path';
    readonly path: string;
  };
  readonly message: string;
  readonly remediation: string;
  readonly disposition: 'active' | 'excepted';
  readonly domain: 'architecture' | 'metadata' | 'product' | 'release' | 'runtime';
  readonly line: string;
}

export interface GovernanceSnapshot {
  readonly root: string;
  readonly architecture: Architecture | null;
  readonly packages: readonly ArchitecturePackage[];
  readonly packageGraph: ReadonlyMap<string, readonly string[]>;
  readonly release: {
    readonly version: string;
    readonly packages: readonly string[];
    readonly publishOrder: readonly string[];
    readonly changelogEntry: string;
  } | null;
  readonly exceptions: readonly [];
  readonly issues: ReadonlyMap<number, Readonly<Record<string, unknown>>> | null;
  readonly findings: readonly GovernanceFinding[];
  readonly queries: Readonly<Partial<Record<'architecture' | 'metadata' | 'product' | 'release' | 'runtime', unknown>>>;
}

export function loadGovernanceSnapshot(input: {
  readonly root: string;
  readonly relationships?: { readonly issues: readonly { readonly number: number }[] };
  readonly checks?: readonly ('architecture' | 'metadata' | 'product' | 'release' | 'runtime')[];
}): Promise<GovernanceSnapshot>;

export function renderGovernanceReport(snapshot: GovernanceSnapshot): string;

export function verifyConsumerParity(input: {
  readonly root: string;
  readonly inventory: {
    readonly groups: readonly {
      readonly id: string;
      readonly paths: readonly string[];
      readonly externalRoot?: string;
    }[];
    readonly commands: readonly string[];
    readonly generatedOutputs: readonly string[];
  };
}): Promise<{
  readonly problems: readonly string[];
  readonly generatedOutputs: readonly string[];
  readonly queryDomains: readonly ('architecture' | 'metadata' | 'product' | 'release' | 'runtime')[];
}>;
