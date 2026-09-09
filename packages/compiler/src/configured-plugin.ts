// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { dirname } from 'node:path';

import { loadConfig } from './config/index.js';
import { zmdbAot as createAotPlugin, type UnpluginLike, type ZmdbAotOptions } from './unplugin/index.js';

export interface ConfiguredZmdbAotOptions extends ZmdbAotOptions {
  /** Use this config path instead of discovery. */
  readonly config?: string;
}

/**
 * Create the AOT plugin, taking its project and naming strategy from `zmdb.config.ts`
 * when the caller did not override them.
 */
export async function zmdbAot(options: ConfiguredZmdbAotOptions = {}): Promise<UnpluginLike> {
  const { config: configPath, ...pluginOptions } = options;
  const configCwd = options.cwd ?? (options.project === undefined ? undefined : dirname(options.project));
  const config =
    configPath === undefined
      ? await loadConfig({
          ...(configCwd === undefined ? {} : { cwd: configCwd }),
          optional: true,
        })
      : await loadConfig({
          ...(configCwd === undefined ? {} : { cwd: configCwd }),
          path: configPath,
        });

  return createAotPlugin({
    ...pluginOptions,
    ...(pluginOptions.project === undefined && config !== undefined ? { project: config.project } : {}),
    ...(pluginOptions.cwd === undefined && config !== undefined ? { cwd: dirname(config.configPath) } : {}),
    ...(pluginOptions.naming === undefined && config !== undefined ? { naming: config.resolvedNaming } : {}),
  });
}
