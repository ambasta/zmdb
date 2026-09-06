import {
  migrate as migrateProject,
  migrationStatus as projectMigrationStatus,
  rollback as rollbackProject,
  type MigrateResult,
  type MigrationCommandOptions,
  type RollbackResult,
  type StatusResult,
} from '@zmdb/migrations/files';
import type { Driver } from '@zmdb/repository';

import type { ResolvedConfig } from '../../config/index.js';
import { configuredMigrationDriver, migrationProject } from '../migration-project.js';

export type { MigrateResult, MigrationCommandOptions, RollbackResult, StatusResult };

export async function migrate(config: ResolvedConfig, options: MigrationCommandOptions): Promise<MigrateResult> {
  const driver = await configuredDriver(config);
  return migrateProject(migrationProject(config, { driver }), options);
}

export async function rollback(
  config: ResolvedConfig,
  target: number | undefined,
  options: MigrationCommandOptions,
): Promise<RollbackResult> {
  const driver = await configuredDriver(config);
  return rollbackProject(migrationProject(config, { driver }), target, options);
}

export async function migrationStatus(config: ResolvedConfig): Promise<StatusResult> {
  const driver = await configuredDriver(config);
  return projectMigrationStatus(migrationProject(config, { driver }));
}

export function configuredDriver(config: ResolvedConfig): Promise<Driver> {
  return configuredMigrationDriver(config);
}
