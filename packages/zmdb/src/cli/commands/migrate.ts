import {
  down,
  downTo,
  driverMigrationConnection,
  status,
  up,
  type MigrationConnection,
  type MigrationStatus,
} from '@zmdb/query-compiler/migrations/runner';
import type { Driver } from '@zmdb/repository';

import type { ResolvedConfig } from '../../config/index.js';
import { CliInvocationError } from '../errors.js';
import { readMigrations, type FileMigration } from '../migration-files.js';

export interface AppliedMigrationResult {
  readonly version: number;
  readonly name: string;
}

export interface MigrateResult {
  readonly applied: readonly AppliedMigrationResult[];
}

export interface RollbackResult {
  readonly reverted: AppliedMigrationResult | null;
  readonly versions: readonly AppliedMigrationResult[];
}

export interface StatusResult {
  readonly migrations: readonly MigrationStatus[];
}

export interface MigrationCommandOptions {
  readonly progress: (text: string) => void;
}

export async function migrate(config: ResolvedConfig, options: MigrationCommandOptions): Promise<MigrateResult> {
  const migrations = await readMigrations(config.outDir);
  const connection = await connectionFor(config);
  const before = await status(connection, migrations);
  const pending = pendingMigrations(migrations, before);
  for (const migration of pending) options.progress(renderMigration('apply', migration));

  const appliedVersions = await up(connection, migrations, {
    onWarning: warning => options.progress(`warning: ${warning}\n`),
  });
  const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
  return {
    applied: appliedVersions.map(version => {
      const migration = byVersion.get(version);
      if (migration === undefined) throw new Error(`runner applied unknown migration ${String(version)}`);
      return { version, name: migration.name };
    }),
  };
}

export async function rollback(
  config: ResolvedConfig,
  target: number | undefined,
  options: MigrationCommandOptions,
): Promise<RollbackResult> {
  const migrations = await readMigrations(config.outDir);
  const connection = await connectionFor(config);
  const before = await status(connection, migrations);
  const applied = before.filter(item => item.applied).toSorted((left, right) => right.version - left.version);
  const selected = target === undefined ? applied.slice(0, 1) : applied.filter(item => item.version > target);
  const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
  for (const item of selected) {
    const migration = byVersion.get(item.version);
    if (migration !== undefined) options.progress(renderMigration('revert', migration));
  }

  const revertedVersions =
    target === undefined
      ? ((version: number | undefined): readonly number[] => (version === undefined ? [] : [version]))(
          await down(connection, migrations),
        )
      : await downTo(connection, migrations, target);
  const versions = revertedVersions.map(version => {
    const migration = byVersion.get(version);
    if (migration === undefined) throw new Error(`runner reverted unknown migration ${String(version)}`);
    return { version, name: migration.name };
  });
  return { reverted: versions[0] ?? null, versions };
}

export async function migrationStatus(config: ResolvedConfig): Promise<StatusResult> {
  const migrations = await readMigrations(config.outDir);
  const connection = await connectionFor(config);
  return { migrations: await status(connection, migrations) };
}

function pendingMigrations(
  migrations: readonly FileMigration[],
  statuses: readonly MigrationStatus[],
): readonly FileMigration[] {
  const applied = new Set(statuses.filter(item => item.applied).map(item => item.version));
  return migrations.filter(migration => !applied.has(migration.version)).toSorted((a, b) => a.version - b.version);
}

function renderMigration(action: 'apply' | 'revert', migration: FileMigration): string {
  const sql = action === 'apply' ? migration.up : migration.down;
  return `${action} ${String(migration.version)} ${migration.name}\n${sql}${sql.endsWith('\n') ? '' : '\n'}`;
}

async function connectionFor(config: ResolvedConfig): Promise<MigrationConnection> {
  const driver = await configuredDriver(config);
  return driverMigrationConnection(driver, config.dialect, {
    ...(config.migrations?.table === undefined ? {} : { table: config.migrations.table }),
    ...(config.migrations?.schema === undefined ? {} : { schema: config.migrations.schema }),
  });
}

export async function configuredDriver(config: ResolvedConfig): Promise<Driver> {
  if (config.driver === undefined) {
    throw new CliInvocationError(`config ${config.configPath} needs a driver for this command`);
  }
  const driver = await config.driver();
  if (driver.dialect !== undefined && driver.dialect !== config.dialect) {
    throw new CliInvocationError(
      `config ${config.configPath} declares ${config.dialect} but its driver declares ${driver.dialect}`,
    );
  }
  return driver;
}
