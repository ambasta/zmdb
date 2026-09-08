const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const delegate = require('metro-babel-transformer');

exports.transform = args => {
  if (args.filename.endsWith('/entry.ts') || args.filename === 'entry.ts') {
    writeFileSync(join(args.options.projectRoot, 'metro-transformed.txt'), args.src);
    return delegate.transform({ ...args, src: `${args.src}\nglobalThis.__ZMDB_PUBLICATION_DELEGATE__ = true;\n` });
  }
  return delegate.transform(args);
};
exports.getCacheKey = options => `publication:${delegate.getCacheKey(options)}`;
