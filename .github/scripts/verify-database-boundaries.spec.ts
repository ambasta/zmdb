import { beforeAll, describe, expect, it } from 'vitest';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import {
  inspectDatabaseBoundaries,
  isShippedGenericSource,
  ROOT,
  runDatabaseBoundaryFixtureProofs,
} from './verify-database-boundaries.mjs';

describe('database boundary verifier (#667)', () => {
  let report: Awaited<ReturnType<typeof inspectDatabaseBoundaries>>;

  beforeAll(async () => {
    const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
    if (snapshot.architecture === null) throw new Error('governance snapshot has no architecture');
    report = await inspectDatabaseBoundaries(ROOT, { architecture: snapshot.architecture });
  }, 30_000);

  // Current ratcheted behavior: grouped official-name findings remain in shipped generic source.
  it.fails('generic production packages contain no official database-name branches', () => {
    const vendorFindings = report.findings.filter(finding =>
      ['official-name', 'official-package-import'].includes(finding.kind),
    );

    expect(vendorFindings).toEqual([]);
  });

  it('a generic install contains no database client', () => {
    const runtimeClients = report.findings.filter(finding => finding.kind === 'generic-client-dependency');

    expect(runtimeClients).toEqual([]);
  });

  it('separates frozen SQL Server names from executable SQL Server implementation', () => {
    const implementation = report.findings.filter(finding => finding.kind === 'sql-server-implementation');
    const compatibilityNames = report.findings.filter(
      finding => finding.kind === 'official-name' && finding.token === 'mssql',
    );

    expect(implementation).toEqual([]);
    expect(compatibilityNames).not.toEqual([]);
  });

  // Current measured behavior: all six package-specific packed consumers are present and valid.
  it('every official database package has a packed consumer fixture', () => {
    const missing = report.findings.filter(finding =>
      ['missing-packed-consumer', 'invalid-packed-consumer', 'unbacked-packed-consumer'].includes(finding.kind),
    );

    expect(missing).toEqual([]);
  });

  it('distinguishes shipped source from tests and fixtures', async () => {
    expect(isShippedGenericSource('packages/query-compiler/src/index.ts')).toBe(true);
    expect(isShippedGenericSource('packages/query-compiler/src/index.spec.ts')).toBe(false);
    expect(isShippedGenericSource('packages/query-compiler/src/__fixtures__/postgres.ts')).toBe(false);
    expect(isShippedGenericSource('packages/query-compiler/src/testing/database-vertical.ts')).toBe(false);
    expect(isShippedGenericSource('packages/schema-core/src/relations/index.ts')).toBe(true);
    expect(isShippedGenericSource('packages/schema-core/src/relations/populate.spec.ts')).toBe(false);

    await expect(runDatabaseBoundaryFixtureProofs()).resolves.toEqual({
      astCases: 8,
      modelCases: 7,
    });
  });
});
