const { getDefaultConfig } = require('metro-config');

module.exports = (async () => {
  const { withZmdb } = require('@zmdb/compiler/metro');
  const defaults = await getDefaultConfig(__dirname);
  return withZmdb(
    {
      ...defaults,
      projectRoot: __dirname,
      maxWorkers: 1,
      cacheStores: [],
      watchFolders: [],
      resetCache: true,
      reporter: { update() {} },
      resolver: { ...defaults.resolver, useWatchman: false },
      transformer: {
        ...defaults.transformer,
        babelTransformerPath: require.resolve('./custom-transformer.cjs'),
      },
    },
    { workerCount: 1 },
  );
})();
