const { resolve } = require('node:path');

const delegate = require('metro-babel-transformer');

const fixtureSource = `${resolve(__dirname, 'src')}/`;

function transform(args) {
  let source = args.src;
  const filename = resolve(args.options.projectRoot, args.filename);
  if (filename.startsWith(fixtureSource)) {
    source += '\nglobalThis.__ZMDB_CUSTOM_TRANSFORMER__ = true;\n';
  }
  return delegate.transform({ ...args, src: source });
}

function getCacheKey(options) {
  return `consumer-metro:${delegate.getCacheKey(options)}`;
}

module.exports = { getCacheKey, transform };
