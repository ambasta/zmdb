export { generateMigration, loadMigrations, type GenerateMigrationOptions, type MigrationResult } from './generator.js';

export {
  down,
  driverMigrationConnection,
  ensureVersionTable,
  runCli,
  status,
  type Migration,
  type MigrationConnection,
  type MigrationDriver,
  type MigrationStatus,
  up,
} from '@zmdb/query-compiler/migrations/runner';

export {
  diff,
  emitDown,
  emitUp,
  snapshot,
  type ChangeOp,
  type ColumnSnapshot,
  type SchemaSnapshot,
  type SnapshotableSchema,
  type TableSnapshot,
} from '@zmdb/query-compiler/migrations';
