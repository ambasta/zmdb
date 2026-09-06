import {
  applyPush as applyMigrationPush,
  isDestructive,
  planPush as planMigrationPush,
  type PushPlan,
  type PushResult,
} from '@zmdb/migrations/files';

import type { ResolvedConfig } from '../../config/index.js';
import { configuredMigrationDriver, reflectedMigrationProject } from '../migration-project.js';

export { isDestructive, type PushPlan, type PushResult };

export async function planPush(config: ResolvedConfig): Promise<PushPlan> {
  const driver = await configuredMigrationDriver(config);
  return planMigrationPush(reflectedMigrationProject(config, driver));
}

export function applyPush(plan: PushPlan, warning: (message: string) => void): Promise<PushResult> {
  return applyMigrationPush(plan, warning);
}
