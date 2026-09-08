import { beforeAll, describe, expect, it } from 'vitest';

import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  withPackedBuildLock,
} from '../../fixtures/client-adapters/src/packed-project.js';
import { runPackedDatabasePackageProofs } from './verify-database-package-imports.mjs';

const ROOT = process.cwd();

describe('database package imports', () => {
  let packedProof: Awaited<ReturnType<typeof runPackedDatabasePackageProofs>>;

  beforeAll(async () => {
    packedProof = await withPackedBuildLock(ROOT, () => runPackedDatabasePackageProofs(ROOT));
  }, PACKED_BUILD_TEST_TIMEOUT_MS);

  it('a default zmdb install includes SQLite without pg mysql2 or mssql', () => {
    expect(packedProof.defaultImported).toEqual(['zmdb', 'zmdb/sqlite']);
    expect(packedProof.defaultAbsent).toEqual(
      expect.arrayContaining(['pg', 'mysql2', 'mssql', '@zmdb/postgres', '@zmdb/mysql', '@zmdb/mssql']),
    );
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
});
