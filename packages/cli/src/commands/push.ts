// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ResolvedConfig } from '@zmdb/compiler/config';
import {
  applyPush as applyMigrationPush,
  isDestructive,
  planPush as planMigrationPush,
  type PushPlan,
  type PushResult,
} from '@zmdb/migrations/files';

import { configuredMigrationDriver, reflectedMigrationProject } from '../migration-project.js';

export { isDestructive, type PushPlan, type PushResult };

export async function planPush(config: ResolvedConfig): Promise<PushPlan> {
  const driver = await configuredMigrationDriver(config);
  return planMigrationPush(reflectedMigrationProject(config, driver));
}

export function applyPush(plan: PushPlan, warning: (message: string) => void): Promise<PushResult> {
  return applyMigrationPush(plan, warning);
}
