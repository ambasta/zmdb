// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ResolvedConfig } from '@zmdb/compiler/config';
import {
  generateMigration as generateProjectMigration,
  type GenerateOptions,
  type GenerateResult,
} from '@zmdb/migrations/files';

import { reflectedMigrationProject } from '../migration-project.js';

export type { GenerateOptions, GenerateResult };

export function generateMigration(config: ResolvedConfig, options: GenerateOptions = {}): Promise<GenerateResult> {
  return generateProjectMigration(reflectedMigrationProject(config), options);
}
