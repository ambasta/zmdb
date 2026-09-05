const { resolve } = require('node:path');

const { getDefaultConfig } = require('metro-config');

async function metroBase() {
  const projectRoot = __dirname;
  const repoRoot = resolve(projectRoot, '../..');
  const config = await getDefaultConfig(projectRoot);
  return {
    ...config,
    maxWorkers: 1,
    projectRoot,
    resetCache: true,
    watchFolders: [repoRoot],
    reporter: { update() {} },
    resolver: {
      ...config.resolver,
      nodeModulesPaths: [resolve(repoRoot, 'node_modules')],
      resolveRequest(context, moduleName, platform) {
        try {
          return context.resolveRequest(context, moduleName, platform);
        } catch (error) {
          if (!moduleName.startsWith('.') || !moduleName.endsWith('.js')) throw error;
          return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform);
        }
      },
      useWatchman: false,
    },
    transformer: {
      ...config.transformer,
      getTransformOptions: async () => ({
        transform: {
          experimentalImportSupport: true,
          inlineRequires: false,
        },
      }),
    },
  };
}

module.exports = { metroBase };
