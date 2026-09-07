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
