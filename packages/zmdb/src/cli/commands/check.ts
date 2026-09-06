import { checkProject as checkMigrationProject, type CheckResult } from '@zmdb/migrations/files';

import type { ResolvedConfig } from '../../config/index.js';
import { reflectedMigrationProject } from '../migration-project.js';

export type { CheckFinding, CheckFindingKind, CheckResult } from '@zmdb/migrations/files';

export async function checkProject(config: ResolvedConfig): Promise<CheckResult> {
  const driver = config.driver === undefined ? undefined : await config.driver();
  return checkMigrationProject(reflectedMigrationProject(config, driver));
}
