import type { ResolvedConfig } from '@zmdb/compiler/config';
import { checkProject as checkMigrationProject, type CheckResult } from '@zmdb/migrations/files';

import { configuredMigrationDriver, reflectedMigrationProject } from '../migration-project.js';

export type { CheckFinding, CheckFindingKind, CheckResult } from '@zmdb/migrations/files';

export async function checkProject(config: ResolvedConfig): Promise<CheckResult> {
  const driver = config.driver === undefined ? undefined : await configuredMigrationDriver(config);
  return checkMigrationProject(reflectedMigrationProject(config, driver));
}
