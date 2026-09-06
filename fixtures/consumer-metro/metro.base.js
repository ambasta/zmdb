const { dirname, resolve } = require('node:path');

const { getDefaultConfig } = require('metro-config');

async function metroBase() {
  const projectRoot = __dirname;
  const repoRoot = resolve(projectRoot, '../..');
  const dependencyRoot = dirname(dirname(require.resolve('metro/package.json')));
  const workspacePackages = {
    zmdb: resolve(repoRoot, 'packages/zmdb'),
    '@zmdb/aot-validator': resolve(repoRoot, 'packages/aot-validator'),
    '@zmdb/client': resolve(repoRoot, 'packages/client'),
    '@zmdb/compiler': resolve(repoRoot, 'packages/compiler'),
    '@zmdb/query-compiler': resolve(repoRoot, 'packages/query-compiler'),
    '@zmdb/react': resolve(repoRoot, 'packages/react'),
    '@zmdb/react-native': resolve(repoRoot, 'packages/react-native'),
    '@zmdb/repository': resolve(repoRoot, 'packages/repository'),
    '@zmdb/schema-core': resolve(repoRoot, 'packages/schema-core'),
    '@zmdb/web': resolve(repoRoot, 'packages/web'),
    react: dirname(require.resolve('react/package.json')),
    'react-native': dirname(require.resolve('react-native/package.json')),
  };
  const config = await getDefaultConfig(projectRoot);
  return {
    ...config,
    cacheStores: [],
    maxWorkers: 1,
    projectRoot,
    resetCache: true,
    watchFolders: [repoRoot, dependencyRoot],
    reporter: { update() {} },
    resolver: {
      ...config.resolver,
      extraNodeModules: {
        ...config.resolver.extraNodeModules,
        ...workspacePackages,
      },
      nodeModulesPaths: [resolve(repoRoot, 'node_modules'), dependencyRoot],
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
