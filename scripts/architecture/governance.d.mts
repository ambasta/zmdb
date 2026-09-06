import type { GovernanceException, GovernanceScope } from './exceptions.mjs';
import type { Architecture, ArchitecturePackage } from './index.mjs';

export interface GovernanceFinding {
  readonly id: string;
  readonly code: string;
  readonly scope: GovernanceScope;
  readonly message: string;
  readonly remediation: string;
  readonly disposition: 'active' | 'excepted';
  readonly exceptionId?: string;
  readonly count?: number;
  readonly domain:
    | 'architecture'
    | 'database-boundaries'
    | 'exceptions'
    | 'metadata'
    | 'product'
    | 'release'
    | 'runtime'
    | 'runtime-foundation'
    | 'server-boundaries'
    | 'tooling-boundaries';
  readonly line: string;
}

export interface GovernanceReleasePlan {
  readonly releaseId: string;
  readonly version: string;
  readonly packages: readonly string[];
  readonly publishOrder: readonly string[];
  readonly manifestChanges: readonly {
    readonly package: string;
    readonly version: string;
    readonly ranges: Readonly<Record<string, string>>;
  }[];
  readonly compatibilityCases: readonly string[];
  readonly changelogEntry: string;
}

export interface GovernanceReleaseQuery {
  readonly architecture: Architecture;
  readonly entries: readonly ArchitecturePackage[];
  readonly releasePolicy: Readonly<Record<string, { readonly group: string }>>;
  readonly plan: GovernanceReleasePlan;
}

export interface GovernanceSnapshot {
  readonly root: string;
  readonly architecture: Architecture | null;
  readonly packages: readonly ArchitecturePackage[];
  readonly packageGraph: ReadonlyMap<string, readonly string[]>;
  readonly release: GovernanceReleasePlan | null;
  readonly exceptions: readonly GovernanceException[];
  readonly issues: ReadonlyMap<number, Readonly<Record<string, unknown>>> | null;
  readonly findings: readonly GovernanceFinding[];
  readonly queries: Readonly<
    Partial<Record<'architecture' | 'exceptions' | 'metadata' | 'product' | 'runtime', unknown>> & {
      readonly release?: GovernanceReleaseQuery;
    }
  >;
}

export function loadGovernanceSnapshot(input: {
  readonly root: string;
  readonly relationships?: {
    readonly issues: readonly {
      readonly number: number;
      readonly state: 'OPEN' | 'CLOSED';
      readonly [field: string]: unknown;
    }[];
  };
  readonly requireExceptionOwnerStates?: boolean;
  readonly checks?: readonly ('architecture' | 'exceptions' | 'metadata' | 'product' | 'release' | 'runtime')[];
}): Promise<GovernanceSnapshot>;

export function readGovernanceRelationshipSnapshot(path: string): {
  readonly complete: true;
  readonly issues: readonly {
    readonly number: number;
    readonly state: 'OPEN' | 'CLOSED';
    readonly [field: string]: unknown;
  }[];
};

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
  readonly queryDomains: readonly ('architecture' | 'exceptions' | 'metadata' | 'product' | 'release' | 'runtime')[];
}>;
