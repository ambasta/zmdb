import { diff, planMigration, snapshot } from '@zmdb/migrations';
import { emitDeclarations } from '@zmdb/migrations/declarations';
import { runEmbedded } from '@zmdb/migrations/embedded';
import { migrate, migrationStatus, readMigrations, rollback, type FileMigration } from '@zmdb/migrations/files';
import { createIntrospector } from '@zmdb/migrations/introspect';
import { normalizeDriftSnapshot, type CatalogSchemaSnapshot } from '@zmdb/migrations/introspect/runtime';
import '@zmdb/migrations/testing';

const empty = snapshot([]);

export const migrationSurface = {
  createIntrospector,
  diff: diff(empty, empty),
  emitDeclarations,
  migrate,
  migrationStatus,
  normalizeDriftSnapshot,
  planMigration,
  readMigrations,
  rollback,
  runEmbedded,
  snapshot,
};

export type MigrationFixtureFile = FileMigration;
export type MigrationFixtureCatalog = CatalogSchemaSnapshot;
