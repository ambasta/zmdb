import type { ResolvedConfig } from '@zmdb/compiler/config';
import { exportSchema as exportProjectSchema, type ExportResult } from '@zmdb/migrations/files';

import { reflectedMigrationProject } from '../migration-project.js';

export type { ExportResult };

export function exportSchema(config: ResolvedConfig): ExportResult {
  return exportProjectSchema(reflectedMigrationProject(config));
}
