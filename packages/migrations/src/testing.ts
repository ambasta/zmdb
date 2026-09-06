import type { AppliedMigration, MigrationConnection } from './runner.js';

export interface MemoryMigrationConnection extends MigrationConnection {
  readonly executed: readonly string[];
  readonly ledger: readonly AppliedMigration[];
}

/** Deterministic in-memory protocol for package consumers and dialect conformance suites. */
export function memoryMigrationConnection(): MemoryMigrationConnection {
  const executed: string[] = [];
  const ledger: AppliedMigration[] = [];
  return {
    executed,
    ledger,
    exec(sql) {
      executed.push(sql);
    },
    appliedVersions() {
      return ledger.map(row => row.version);
    },
    appliedMigrations() {
      return ledger;
    },
    recordApplied(version, name, checksum) {
      ledger.push({ version, name, checksum: checksum ?? null });
    },
    recordReverted(version) {
      const index = ledger.findIndex(row => row.version === version);
      if (index >= 0) ledger.splice(index, 1);
    },
  };
}
