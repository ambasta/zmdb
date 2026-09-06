const { withZmdb } = require('@zmdb/compiler/metro');

const { metroBase } = require('./metro.base.js');

module.exports = metroBase().then(config =>
  withZmdb(
    {
      ...config,
      transformer: {
        ...config.transformer,
        babelTransformerPath: require.resolve('./custom-transformer.js'),
      },
    },
    { workerCount: 1 },
  ),
);
