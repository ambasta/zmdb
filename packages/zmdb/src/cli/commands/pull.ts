import {
  pullDeclarations as pullProjectDeclarations,
  type PullExecution,
  type PullOptions,
} from '@zmdb/migrations/files';

import type { ResolvedConfig } from '../../config/index.js';
import { configuredIntrospector } from '../database.js';
import { configuredMigrationDriver, migrationProject } from '../migration-project.js';

export type {
  PullExecution,
  PullFile,
  PullOptions,
  PullOutputFile,
  PullResult,
  PullSkippedFile,
} from '@zmdb/migrations/files';

export async function pullDeclarations(config: ResolvedConfig, options: PullOptions = {}): Promise<PullExecution> {
  if (config.driver === undefined) {
    throw new TypeError('the config must declare a driver thunk before pull can connect');
  }
  const driver = await configuredMigrationDriver(config);
  return pullProjectDeclarations(
    migrationProject(config, {
      driver,
      introspector: configuredIntrospector(driver.dialect ?? config.dialect),
    }),
    options,
  );
}
