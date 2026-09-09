// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ResolvedConfig } from '@zmdb/compiler/config';
import {
  embedMigrations as embedProjectMigrations,
  embeddedOutputPath as projectEmbeddedOutputPath,
  renderEmbeddedModule as renderProjectEmbeddedModule,
  type EmbeddedModuleResult,
  type EmbedOptions,
  type EmbedResult,
} from '@zmdb/migrations/files';

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
  if (!config.dialect.migrations.embedded) {
    throw new CliInvocationError(
      `embedded migrations are not supported by ${config.dialect.name} in ${config.configPath}`,
    );
  }
  return embedProjectMigrations(migrationProject(config), options);
}
