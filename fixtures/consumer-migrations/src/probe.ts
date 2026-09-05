import { diff, planMigration, snapshot } from '@zmdb/migrations';
import { emitDeclarations } from '@zmdb/migrations/declarations';
import { runEmbedded } from '@zmdb/migrations/embedded';
import { readMigrations, type FileMigration } from '@zmdb/migrations/files';
import { createIntrospector } from '@zmdb/migrations/introspect';
import { migrate, migrationStatus, rollback } from '@zmdb/migrations/runner';
import '@zmdb/migrations/testing';

const empty = snapshot([]);

export const migrationSurface = {
  createIntrospector,
  diff: diff(empty, empty),
  emitDeclarations,
  migrate,
  migrationStatus,
  planMigration,
  readMigrations,
  rollback,
  runEmbedded,
  snapshot,
};

export type MigrationFixtureFile = FileMigration;
