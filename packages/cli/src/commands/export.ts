// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ResolvedConfig } from '@zmdb/compiler/config';
import { exportSchema as exportProjectSchema, type ExportResult } from '@zmdb/migrations/files';

import { reflectedMigrationProject } from '../migration-project.js';

export type { ExportResult };

export function exportSchema(config: ResolvedConfig): ExportResult {
  return exportProjectSchema(reflectedMigrationProject(config));
}
