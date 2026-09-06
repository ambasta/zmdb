const { builtinModules } = require('node:module');

const { withZmdb } = require('@zmdb/aot-validator/metro');

const { metroBase } = require('./metro.base.js');

const nodeBuiltins = new Set(
  builtinModules.flatMap(name => {
    const plain = name.startsWith('node:') ? name.slice('node:'.length) : name;
    return [plain, `node:${plain}`];
  }),
);

module.exports = metroBase().then(config =>
  withZmdb(
    {
      ...config,
      resolver: {
        ...config.resolver,
        resolveRequest(context, moduleName, platform) {
          if (nodeBuiltins.has(moduleName)) {
            throw new Error(`React Native bundle reached Node built-in ${moduleName}`);
          }
          return config.resolver.resolveRequest(context, moduleName, platform);
        },
      },
      transformer: {
        ...config.transformer,
        babelTransformerPath: require.resolve('./custom-transformer.js'),
      },
    },
    { workerCount: 1 },
  ),
);
