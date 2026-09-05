import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  architectureExceptionInventory,
  createGovernanceFinding,
  databaseBoundaryFinding,
  GOVERNANCE_EXCEPTIONS,
  type GovernanceException,
  governanceExceptionsForSource,
  ownerStatesFromGovernanceSnapshot,
  renderGovernanceExceptionMigrationReport,
  serverBoundaryProblemFinding,
  toolingGeneratedFinding,
  toolingRuntimeFinding,
  validateGovernanceExceptions,
  verifyGovernanceExceptionSource,
  verifyGovernanceSnapshotExceptionSource,
} from '../../scripts/architecture/exceptions.mjs';
import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import { inspectDatabaseBoundaries, findingSignature } from './verify-database-boundaries.mjs';
import { inspectRuntimeFoundation } from './verify-runtime-foundation.mjs';
import { analyzeServerBoundaries } from './verify-server-boundaries.mjs';
import { analyseToolingBoundaries } from './verify-tooling-boundaries.mjs';

const ROOT = process.cwd();
const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
const ARCHITECTURE = GOVERNANCE.architecture;
if (ARCHITECTURE === null) throw new Error('governance snapshot has no architecture');
const OPAQUE_BASELINES = [
  '.github/scripts/database-boundary-baseline.json',
  '.github/scripts/runtime-foundation-baseline.json',
  '.github/scripts/server-boundaries-baseline.json',
];

function ownerStates(): Readonly<Record<string, 'OPEN'>> {
  return Object.fromEntries(architectureExceptionInventory().owners.map(issue => [String(issue), 'OPEN' as const]));
}

function fixtureFinding(count = 1) {
  return createGovernanceFinding({
    code: 'TEST_DEBT',
    scope: { kind: 'path', path: 'packages/example/src/index.ts' },
    message: 'fixture debt',
    count,
  });
}

function validFixtureException(): GovernanceException {
  const finding = fixtureFinding();
  return {
    id: 'GEX-test-debt',
    findingId: finding.id,
    scope: finding.scope,
    rationale: 'Fixture debt remains until the test owner removes it.',
    introduced: {
      issue: 732,
      commit: '696feb9739183341025a6dcc2bcf28eedda394b0',
      evidence: ['scripts/architecture/__fixtures__/governance/exceptions.json'],
    },
    ownerIssue: 735,
    ceiling: { metric: 'finding-count', maximum: 1 },
    removeWhen: { kind: 'finding-absent' },
    migration: { source: 'fixture', entry: 'fixture debt' },
  };
}

function fixtureException(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    ...validFixtureException(),
    ...overrides,
  };
}

describe('owned architecture exceptions (#735)', () => {
  it('accounts for all 81 opaque entries and deletes their old stores', async () => {
    const database = await inspectDatabaseBoundaries(ROOT, { architecture: ARCHITECTURE });
    const runtime = inspectRuntimeFoundation(ROOT, { architecture: ARCHITECTURE });
    const server = analyzeServerBoundaries(ROOT, { architecture: ARCHITECTURE });
    const tooling = analyseToolingBoundaries({
      architecture: ARCHITECTURE,
      snapshot: GOVERNANCE,
    });

    const legacyBySource = {
      'database-boundaries': database.findings.map(findingSignature).toSorted(),
      'runtime-foundation': [...runtime.problems].toSorted(),
      'server-boundaries': [...server].toSorted(),
      'tooling-boundaries': [
        ...tooling.runtimeViolations.map(violation => violation.id),
        ...tooling.generatedViolations.map(violation => `${violation.path}|${violation.specifier}|${violation.reason}`),
      ].toSorted(),
    };

    expect(architectureExceptionInventory()).toEqual({
      total: 83,
      bySource: {
        'database-boundaries': 0,
        'runtime-foundation': 80,
        'server-boundaries': 0,
        'tooling-boundaries': 3,
      },
      owners: [637, 638, 639, 640, 641],
      ceiling: 269,
      migration: {
        legacyTotal: 83,
        retiredTotal: 0,
        retiredBySource: {
          'database-boundaries': 0,
          'runtime-foundation': 0,
          'server-boundaries': 0,
          'tooling-boundaries': 0,
        },
      },
    });
    for (const [source, legacy] of Object.entries(legacyBySource)) {
      expect(
        governanceExceptionsForSource(source)
          .map(exception => exception.migration.entry)
          .toSorted(),
        source,
      ).toEqual(legacy);
    }
    for (const path of OPAQUE_BASELINES) expect(existsSync(join(ROOT, path)), path).toBe(false);
  }, 20_000);

  it('classifies the live findings exactly and preserves every owned finding in reports', async () => {
    const database = await inspectDatabaseBoundaries(ROOT, { architecture: ARCHITECTURE });
    const runtime = inspectRuntimeFoundation(ROOT, { architecture: ARCHITECTURE });
    const server = analyzeServerBoundaries(ROOT, { architecture: ARCHITECTURE });
    const tooling = analyseToolingBoundaries({
      architecture: ARCHITECTURE,
      snapshot: GOVERNANCE,
    });
    const states = ownerStates();

    const reports = [
      verifyGovernanceExceptionSource({
        source: 'database-boundaries',
        rawFindings: database.findings.map(databaseBoundaryFinding),
        ownerStates: states,
      }),
      verifyGovernanceExceptionSource({
        source: 'runtime-foundation',
        rawFindings: runtime.findings,
        ownerStates: states,
      }),
      verifyGovernanceExceptionSource({
        source: 'server-boundaries',
        rawFindings: server.map(serverBoundaryProblemFinding),
        ownerStates: states,
      }),
      verifyGovernanceExceptionSource({
        source: 'tooling-boundaries',
        rawFindings: [
          ...tooling.runtimeViolations.map(toolingRuntimeFinding),
          ...tooling.generatedViolations.map(toolingGeneratedFinding),
        ],
        ownerStates: states,
      }),
    ];

    for (const report of reports) {
      expect(report.diagnostics).toEqual([]);
      expect(report.findings.every(finding => finding.disposition === 'excepted')).toBe(true);
    }
    expect(reports.flatMap(report => report.findings)).toHaveLength(83);

    const migration = renderGovernanceExceptionMigrationReport();
    expect(migration).toContain('- total legacy entries: 83');
    expect(migration).toContain('- total live exceptions: 83');
    expect(migration).toContain('- total retired entries: 0');
    expect(migration.split('\n').filter(line => line.startsWith('| `'))).toHaveLength(83);
    expect(renderGovernanceExceptionMigrationReport()).toBe(migration);
  }, 20_000);

  it('consumes #734 governance snapshot issue states without recreating graph authority', () => {
    const finding = fixtureFinding();
    const exceptions = [validFixtureException()];
    expect(
      verifyGovernanceSnapshotExceptionSource({
        snapshot: { root: ROOT, packageGraph: new Map(), exceptions, issues: null },
        source: 'fixture',
        rawFindings: [finding],
      }).diagnostics.map(diagnostic => diagnostic.code),
    ).toEqual(['GOV_EXCEPTION_RELATIONSHIPS_REQUIRED']);

    const openSnapshot = {
      root: ROOT,
      packageGraph: new Map<string, readonly string[]>(),
      exceptions,
      issues: new Map([[735, Object.freeze({ number: 735, state: 'OPEN' as const })]]),
    };
    expect(ownerStatesFromGovernanceSnapshot(openSnapshot)).toEqual({ 735: 'OPEN' });
    expect(
      verifyGovernanceSnapshotExceptionSource({
        snapshot: openSnapshot,
        source: 'fixture',
        rawFindings: [finding],
      }).diagnostics,
    ).toEqual([]);

    const closedSnapshot = {
      root: ROOT,
      packageGraph: new Map<string, readonly string[]>(),
      exceptions,
      issues: new Map([[735, Object.freeze({ number: 735, state: 'CLOSED' as const })]]),
    };
    expect(
      verifyGovernanceSnapshotExceptionSource({
        snapshot: closedSnapshot,
        source: 'fixture',
        rawFindings: [finding],
      }).diagnostics.map(diagnostic => diagnostic.code),
    ).toEqual(['GOV_EXCEPTION_OWNER_CLOSED']);
  });

  it('publishes byte-identical focused exception reports through the aggregate snapshot', async () => {
    const snapshot = await loadGovernanceSnapshot({ root: ROOT });
    const query = snapshot.queries.exceptions as
      | {
          readonly inventory: ReturnType<typeof architectureExceptionInventory>;
          readonly reports: Readonly<
            Record<
              string,
              {
                readonly diagnostics: readonly unknown[];
                readonly findings: readonly { readonly disposition: string }[];
              }
            >
          >;
        }
      | undefined;
    expect(snapshot.exceptions).toBe(GOVERNANCE_EXCEPTIONS);
    expect(query?.inventory).toEqual(architectureExceptionInventory());
    expect(Object.values(query?.reports ?? {}).flatMap(report => report.diagnostics)).toEqual([]);
    expect(Object.values(query?.reports ?? {}).flatMap(report => report.findings)).toHaveLength(83);
    expect(
      Object.values(query?.reports ?? {})
        .flatMap(report => report.findings)
        .every(finding => finding.disposition === 'excepted'),
    ).toBe(true);
    expect(snapshot.findings.filter(finding => finding.disposition === 'active')).toEqual([]);
    expect(snapshot.findings.filter(finding => finding.disposition === 'excepted')).toHaveLength(83);
  }, 90_000);

  it('rejects an ownerless or permanent-by-omission exception', () => {
    const finding = fixtureFinding();
    const ownerless = validateGovernanceExceptions({
      exceptions: [fixtureException({ ownerIssue: undefined })],
      rawFindings: [finding],
      ownerStates: {},
    });
    expect(ownerless.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['GOV_EXCEPTION_OWNER_MISSING']);

    const permanent = validateGovernanceExceptions({
      exceptions: [fixtureException({ removeWhen: undefined })],
      rawFindings: [finding],
      ownerStates: { 735: 'OPEN' },
    });
    expect(permanent.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'GOV_EXCEPTION_REMOVAL_CONDITION_INVALID',
    ]);
  });

  it('requires a ceiling reduction when debt shrinks and deletion when it disappears', () => {
    const shrunk = validateGovernanceExceptions({
      exceptions: [fixtureException({ ceiling: { metric: 'finding-count', maximum: 2 } })],
      rawFindings: [fixtureFinding()],
      ownerStates: { 735: 'OPEN' },
    });
    expect(shrunk.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['GOV_EXCEPTION_CEILING_RAISED']);

    const disappeared = validateGovernanceExceptions({
      exceptions: [fixtureException()],
      rawFindings: [],
      ownerStates: { 735: 'OPEN' },
    });
    expect(disappeared.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['GOV_EXCEPTION_FINDING_ABSENT']);
    expect(disappeared.diagnostics[0]?.message).toContain('delete GEX-test-debt');
  });

  it('evaluates path and package-edge removal conditions from the governance snapshot', () => {
    const finding = fixtureFinding();
    const pathRemoved = validateGovernanceExceptions({
      exceptions: [
        fixtureException({
          removeWhen: { kind: 'path-absent', path: 'packages/example/src/removed.ts' },
        }),
      ],
      rawFindings: [finding],
      ownerStates: { 735: 'OPEN' },
      root: ROOT,
    });
    expect(pathRemoved.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['GOV_EXCEPTION_REMOVAL_DUE']);

    const edgeRemoved = validateGovernanceExceptions({
      exceptions: [
        fixtureException({
          removeWhen: { kind: 'edge-absent', consumer: 'example', dependency: 'removed-dependency' },
        }),
      ],
      rawFindings: [finding],
      ownerStates: { 735: 'OPEN' },
      root: ROOT,
      packageGraph: new Map([['example', []]]),
    });
    expect(edgeRemoved.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['GOV_EXCEPTION_REMOVAL_DUE']);
  });

  it('cannot hide a new path behind an existing scoped exception', () => {
    const original = fixtureFinding();
    const planted = createGovernanceFinding({
      code: original.code,
      scope: { kind: 'path', path: 'packages/example/src/new-path.ts' },
      message: 'planted debt',
    });
    const report = validateGovernanceExceptions({
      exceptions: [fixtureException()],
      rawFindings: [original, planted],
      ownerStates: { 735: 'OPEN' },
    });
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['GOV_EXCEPTION_UNOWNED_FINDING']);
    expect(report.diagnostics[0]?.message).toContain(encodeURIComponent('packages/example/src/new-path.ts'));
  });

  it('rejects wildcard scopes, duplicate ids, and closed owners', () => {
    const finding = fixtureFinding();
    const wildcard = validateGovernanceExceptions({
      exceptions: [
        fixtureException({
          scope: { kind: 'path', path: 'packages/**' },
          findingId: 'TEST_DEBT/path/packages%2F**',
        }),
      ],
      rawFindings: [finding],
      ownerStates: { 735: 'OPEN' },
    });
    expect(wildcard.diagnostics.map(diagnostic => diagnostic.code)).toContain('GOV_EXCEPTION_SCOPE_INVALID');

    const proseOnly = validateGovernanceExceptions({
      exceptions: [
        fixtureException({
          scope: { kind: 'entry', packageId: 'example', selector: 'some prose identity' },
          findingId: 'TEST_DEBT/entry/example%3Asome%20prose%20identity',
        }),
      ],
      rawFindings: [finding],
      ownerStates: { 735: 'OPEN' },
    });
    expect(proseOnly.diagnostics.map(diagnostic => diagnostic.code)).toContain('GOV_EXCEPTION_SCOPE_INVALID');

    const duplicate = validateGovernanceExceptions({
      exceptions: [
        fixtureException(),
        fixtureException({
          findingId: 'OTHER_DEBT/path/packages%2Fexample%2Fsrc%2Fother.ts',
          scope: { kind: 'path', path: 'packages/example/src/other.ts' },
        }),
      ],
      rawFindings: [finding],
      ownerStates: { 735: 'OPEN' },
    });
    expect(duplicate.diagnostics.map(diagnostic => diagnostic.code)).toContain('GOV_EXCEPTION_DUPLICATE_ID');

    const closed = validateGovernanceExceptions({
      exceptions: [fixtureException()],
      rawFindings: [finding],
      ownerStates: { 735: 'CLOSED' },
    });
    expect(closed.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['GOV_EXCEPTION_OWNER_CLOSED']);
  });

  it('is deeply frozen, deterministically ordered, and backed by existing evidence', () => {
    expect(Object.isFrozen(GOVERNANCE_EXCEPTIONS)).toBe(true);
    const order = GOVERNANCE_EXCEPTIONS.map(
      exception => `${exception.migration.source}\u0000${exception.findingId}\u0000${exception.id}`,
    );
    expect(order).toEqual(order.toSorted((left, right) => left.localeCompare(right)));
    expect(new Set(GOVERNANCE_EXCEPTIONS.map(exception => exception.id)).size).toBe(83);
    expect(
      new Set(GOVERNANCE_EXCEPTIONS.map(exception => `${exception.findingId}:${JSON.stringify(exception.scope)}`)).size,
    ).toBe(83);
    for (const exception of GOVERNANCE_EXCEPTIONS) {
      expect(Object.isFrozen(exception)).toBe(true);
      expect(Object.isFrozen(exception.scope)).toBe(true);
      expect(Object.isFrozen(exception.introduced.evidence)).toBe(true);
      for (const evidence of exception.introduced.evidence) {
        expect(existsSync(join(ROOT, evidence)), `${exception.id}:${evidence}`).toBe(true);
      }
    }
  });
});
