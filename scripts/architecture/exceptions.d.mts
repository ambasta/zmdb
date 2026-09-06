export type GovernanceScope =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'entry'; readonly packageId: string; readonly selector: string }
  | { readonly kind: 'edge'; readonly consumer: string; readonly dependency: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'issue'; readonly issue: number };

export interface GovernanceFinding {
  readonly id: string;
  readonly code: string;
  readonly scope: GovernanceScope;
  readonly message: string;
  readonly remediation: string;
  readonly count: number;
}

export interface GovernanceException {
  readonly id: `GEX-${string}`;
  readonly findingId: string;
  readonly scope: GovernanceScope;
  readonly rationale: string;
  readonly introduced: {
    readonly issue: number;
    readonly commit: string;
    readonly evidence: readonly string[];
  };
  readonly ownerIssue: number;
  readonly ceiling: {
    readonly metric: 'finding-count';
    readonly maximum: number;
  };
  readonly removeWhen:
    | { readonly kind: 'finding-absent' }
    | { readonly kind: 'count-at-most'; readonly maximum: number }
    | { readonly kind: 'path-absent'; readonly path: string }
    | { readonly kind: 'edge-absent'; readonly consumer: string; readonly dependency: string };
  readonly migration: {
    readonly source: string;
    readonly entry: string;
  };
}

export interface GovernanceExceptionDiagnostic {
  readonly code: string;
  readonly exceptionId: string;
  readonly message: string;
}

export interface GovernanceExceptionReport {
  readonly diagnostics: readonly GovernanceExceptionDiagnostic[];
  readonly findings: readonly (GovernanceFinding & {
    readonly disposition: 'active' | 'excepted';
    readonly exceptionId?: string;
  })[];
}

export interface GovernanceExceptionSnapshotAdapter {
  readonly root: string;
  readonly packageGraph: ReadonlyMap<string, readonly string[]>;
  readonly exceptions: readonly GovernanceException[];
  readonly issues: ReadonlyMap<
    number,
    Readonly<{
      readonly number?: number;
      readonly state: 'OPEN' | 'CLOSED';
      readonly [field: string]: unknown;
    }>
  > | null;
}

export interface RetiredGovernanceBaselineEntry {
  readonly source: string;
  readonly entry: string;
  readonly retiredBy: number;
  readonly evidence: string;
}

export const GOVERNANCE_EXCEPTIONS: readonly GovernanceException[];

export function createGovernanceFinding(input: {
  readonly code: string;
  readonly scope: GovernanceScope;
  readonly message: string;
  readonly count?: number;
  readonly remediation?: string;
}): GovernanceFinding;

export function databaseBoundaryFinding(finding: {
  readonly kind: string;
  readonly path: string;
  readonly token: string;
  readonly count: number;
}): GovernanceFinding;

export function runtimeFoundationOptionalFinding(input: {
  readonly target: string;
  readonly reached: string;
  readonly path: string;
  readonly specifier: string;
}): GovernanceFinding;

export function runtimeFoundationProblemFinding(problem: string): GovernanceFinding;
export function serverBoundaryProblemFinding(problem: string): GovernanceFinding;

export function toolingRuntimeFinding(violation: {
  readonly entry: string;
  readonly source: string;
  readonly specifier: string;
  readonly id: string;
}): GovernanceFinding;

export function toolingGeneratedFinding(violation: {
  readonly path: string;
  readonly specifier: string;
  readonly reason: string;
}): GovernanceFinding;

export function governanceExceptionsForSource(
  source: string,
  exceptions?: readonly GovernanceException[],
): readonly GovernanceException[];

export function validateGovernanceExceptions(input: {
  readonly exceptions: readonly (GovernanceException | Readonly<Record<string, unknown>>)[];
  readonly rawFindings: readonly (GovernanceFinding | Readonly<Record<string, unknown>>)[];
  readonly ownerStates?: Readonly<Record<string | number, 'OPEN' | 'CLOSED'>>;
  readonly root?: string;
  readonly packageGraph?: ReadonlyMap<string, readonly string[]>;
}): GovernanceExceptionReport;

export function verifyGovernanceExceptionSource(input: {
  readonly source: string;
  readonly rawFindings: readonly GovernanceFinding[];
  readonly ownerStates?: Readonly<Record<string | number, 'OPEN' | 'CLOSED'>>;
  readonly root?: string;
  readonly packageGraph?: ReadonlyMap<string, readonly string[]>;
  readonly exceptions?: readonly GovernanceException[];
}): GovernanceExceptionReport;

export function ownerStatesFromGovernanceSnapshot(
  snapshot: GovernanceExceptionSnapshotAdapter,
): Readonly<Record<string, 'OPEN' | 'CLOSED'>> | undefined;

export function verifyGovernanceSnapshotExceptionSource(input: {
  readonly snapshot: GovernanceExceptionSnapshotAdapter;
  readonly source: string;
  readonly rawFindings: readonly GovernanceFinding[];
  readonly exceptions?: readonly GovernanceException[];
  readonly requireOwnerStates?: boolean;
}): GovernanceExceptionReport;

export function renderGovernanceExceptionMigrationReport(
  exceptions?: readonly GovernanceException[],
  retiredEntries?: readonly RetiredGovernanceBaselineEntry[],
): string;

export function architectureExceptionInventory(
  exceptions?: readonly GovernanceException[],
  retiredEntries?: readonly RetiredGovernanceBaselineEntry[],
): {
  readonly total: number;
  readonly bySource: Readonly<Record<string, number>>;
  readonly owners: readonly number[];
  readonly ceiling: number;
  readonly migration: {
    readonly legacyTotal: number;
    readonly retiredTotal: number;
    readonly retiredBySource: Readonly<Record<string, number>>;
  };
};
