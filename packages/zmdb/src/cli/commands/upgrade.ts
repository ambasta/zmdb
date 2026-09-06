import { upgradeSnapshot as upgradeProjectSnapshot, type UpgradeResult } from '@zmdb/migrations/files';

import type { ResolvedConfig } from '../../config/index.js';
import { migrationProject, rethrowProjectError } from '../migration-project.js';

export type { UpgradeResult };

export async function upgradeSnapshot(config: ResolvedConfig): Promise<UpgradeResult> {
  try {
    return await upgradeProjectSnapshot(migrationProject(config));
  } catch (error) {
    rethrowProjectError(error);
  }
}
