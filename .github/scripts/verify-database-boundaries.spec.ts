import { describe, expect, it } from 'vitest';

import {
  inspectDatabaseBoundaries,
  isShippedGenericSource,
  runDatabaseBoundaryFixtureProofs,
} from './verify-database-boundaries.mjs';

describe('database boundary verifier (#667)', () => {
  // Current measured behavior: 57 grouped official-name findings remain in shipped generic source.
  it.fails('generic production packages contain no official database-name branches', async () => {
    const report = await inspectDatabaseBoundaries();
    const vendorFindings = report.findings.filter(finding =>
      ['official-name', 'official-package-import'].includes(finding.kind),
    );

    expect(vendorFindings).toEqual([]);
  });

  it('a generic install contains no database client', async () => {
    const report = await inspectDatabaseBoundaries();
    const runtimeClients = report.findings.filter(finding => finding.kind === 'generic-client-dependency');

    expect(runtimeClients).toEqual([]);
  });

  it('separates frozen SQL Server names from executable SQL Server implementation', async () => {
    const report = await inspectDatabaseBoundaries();
    const implementation = report.findings.filter(finding => finding.kind === 'sql-server-implementation');
    const compatibilityNames = report.findings.filter(
      finding => finding.kind === 'official-name' && finding.token === 'mssql',
    );

    expect(implementation).toEqual([]);
    expect(compatibilityNames).not.toEqual([]);
  });

  // Current measured behavior: all six package-specific packed-consumer directories are absent.
  it.fails('every official database package has a packed consumer fixture', async () => {
    const report = await inspectDatabaseBoundaries();
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
