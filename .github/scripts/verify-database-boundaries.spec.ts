import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import { createDependencyGraph, topologicalOrder } from '../../scripts/architecture/index.mjs';
import {
  inspectDatabaseBoundaries,
  isShippedGenericSource,
  ROOT,
  runDatabaseBoundaryFixtureProofs,
} from './verify-database-boundaries.mjs';
import { runPackedDatabasePackageProofs } from './verify-database-package-imports.mjs';

describe('database boundary verifier (#667)', () => {
  let report: Awaited<ReturnType<typeof inspectDatabaseBoundaries>>;
  let packedProof: Awaited<ReturnType<typeof runPackedDatabasePackageProofs>>;
  let architecture: NonNullable<Awaited<ReturnType<typeof loadGovernanceSnapshot>>['architecture']>;

  beforeAll(async () => {
    const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
    if (snapshot.architecture === null) throw new Error('governance snapshot has no architecture');
    architecture = snapshot.architecture;
    report = await inspectDatabaseBoundaries(ROOT, { architecture: snapshot.architecture });
    packedProof = await runPackedDatabasePackageProofs(ROOT);
  }, 180_000);

  it('generic shipped source contains no official database implementation', () => {
    const vendorFindings = report.findings.filter(finding =>
      ['official-name', 'official-package-import'].includes(finding.kind),
    );

    expect(vendorFindings).toEqual([]);
  });

  it('a default zmdb install does not install pg mysql2 or mssql', () => {
    const runtimeClients = report.findings.filter(finding => finding.kind === 'generic-client-dependency');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', 'zmdb', 'package.json'), 'utf8')) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };

    expect(runtimeClients).toEqual([]);
    expect(Object.keys(manifest.dependencies)).not.toEqual(
      expect.arrayContaining(['pg', 'mysql2', 'mssql', '@zmdb/postgres', '@zmdb/mysql', '@zmdb/mssql']),
    );
    expect(packedProof.defaultAbsent).toEqual(
      expect.arrayContaining(['pg', 'mysql2', 'mssql', '@zmdb/postgres', '@zmdb/mysql', '@zmdb/mssql']),
    );
  });

  it('selecting PostgreSQL imports only @zmdb/postgres', () => {
    const source = readFileSync(join(ROOT, 'packages', 'zmdb', 'src', 'database-postgres.ts'), 'utf8');
    expect([...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1])).toEqual(['@zmdb/postgres']);
  });

  it('contains neither frozen SQL Server names nor executable SQL Server implementation', () => {
    const implementation = report.findings.filter(finding => finding.kind === 'sql-server-implementation');
    const compatibilityNames = report.findings.filter(
      finding => finding.kind === 'official-name' && finding.token === 'mssql',
    );

    expect(implementation).toEqual([]);
    expect(compatibilityNames).toEqual([]);
  });

  // Current measured behavior: all six package-specific packed consumers are present and valid.
  it('every official database package has a packed consumer fixture', () => {
    const missing = report.findings.filter(finding =>
      ['missing-packed-consumer', 'invalid-packed-consumer', 'unbacked-packed-consumer'].includes(finding.kind),
    );

    expect(missing).toEqual([]);
  });

  it('every packed database package imports under plain Node', () => {
    expect(packedProof.imported).toEqual([
      '@zmdb/sqlite',
      '@zmdb/postgres',
      '@zmdb/mysql',
      '@zmdb/mssql',
      '@zmdb/cockroach',
      '@zmdb/singlestore',
    ]);
  });

  it('all database dependency edges are acyclic', () => {
    expect(topologicalOrder(createDependencyGraph(architecture))).toHaveLength(architecture.packages.length);
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
