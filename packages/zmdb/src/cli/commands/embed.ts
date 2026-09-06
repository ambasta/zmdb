import {
  embedMigrations as embedProjectMigrations,
  embeddedOutputPath as projectEmbeddedOutputPath,
  renderEmbeddedModule as renderProjectEmbeddedModule,
  type EmbeddedModuleResult,
  type EmbedOptions,
  type EmbedResult,
} from '@zmdb/migrations/files';

import type { ResolvedConfig } from '../../config/index.js';
import { CliInvocationError } from '../errors.js';
import { migrationProject } from '../migration-project.js';

export type { EmbeddedModuleResult, EmbedOptions, EmbedResult };

export const EMBEDDED_WITH_DOWN_MARKER = '// Includes down sections for development tooling.';

export function embeddedOutputPath(config: ResolvedConfig, requested?: string): string {
  return projectEmbeddedOutputPath(migrationProject(config), requested);
}

export function renderEmbeddedModule(
  config: ResolvedConfig,
  options: EmbedOptions = {},
): Promise<EmbeddedModuleResult> {
  return renderProjectEmbeddedModule(migrationProject(config), options);
}

export function embedMigrations(config: ResolvedConfig, options: EmbedOptions = {}): Promise<EmbedResult> {
  if (config.dialect !== 'sqlite') {
    throw new CliInvocationError(
      `embedded migrations execute SQLite, but ${config.configPath} configures ${config.dialect}`,
    );
  }
  return embedProjectMigrations(migrationProject(config), options);
}
