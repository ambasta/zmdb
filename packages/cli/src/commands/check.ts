// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ResolvedConfig } from '@zmdb/compiler/config';
import { checkProject as checkMigrationProject, type CheckResult } from '@zmdb/migrations/files';

import { configuredMigrationDriver, reflectedMigrationProject } from '../migration-project.js';

export type { CheckFinding, CheckFindingKind, CheckResult } from '@zmdb/migrations/files';

export async function checkProject(config: ResolvedConfig): Promise<CheckResult> {
  const driver = config.driver === undefined ? undefined : await configuredMigrationDriver(config);
  return checkMigrationProject(reflectedMigrationProject(config, driver));
}
