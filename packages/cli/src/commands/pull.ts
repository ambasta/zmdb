// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ResolvedConfig } from '@zmdb/compiler/config';
import {
  pullDeclarations as pullProjectDeclarations,
  type PullExecution,
  type PullOptions,
} from '@zmdb/migrations/files';

import { configuredIntrospector } from '../database.js';
import { configuredMigrationDriver, migrationProject } from '../migration-project.js';

export type {
  PullExecution,
  PullFile,
  PullOptions,
  PullOutputFile,
  PullResult,
  PullSkippedFile,
} from '@zmdb/migrations/files';

export async function pullDeclarations(config: ResolvedConfig, options: PullOptions = {}): Promise<PullExecution> {
  if (config.driver === undefined) {
    throw new TypeError('the config must declare a driver thunk before pull can connect');
  }
  const driver = await configuredMigrationDriver(config);
  return pullProjectDeclarations(
    migrationProject(config, {
      driver,
      introspector: configuredIntrospector(driver.dialect),
    }),
    options,
  );
}
