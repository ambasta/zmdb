// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ResolvedConfig } from '@zmdb/compiler/config';
import { upgradeSnapshot as upgradeProjectSnapshot, type UpgradeResult } from '@zmdb/migrations/files';

import { migrationProject, rethrowProjectError } from '../migration-project.js';

export type { UpgradeResult };

export async function upgradeSnapshot(config: ResolvedConfig): Promise<UpgradeResult> {
  try {
    return await upgradeProjectSnapshot(migrationProject(config));
  } catch (error) {
    rethrowProjectError(error);
  }
}
