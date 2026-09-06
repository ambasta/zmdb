import { dirname } from 'node:path';

import { loadConfig } from '@zmdb/compiler/config';
import { zmdbAot as createAotPlugin, type UnpluginLike, type ZmdbAotOptions } from '@zmdb/compiler/unplugin';

export type { UnpluginLike, ZmdbAotOptions } from '@zmdb/compiler/unplugin';

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
