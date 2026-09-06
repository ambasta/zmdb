const { appendFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const delegate = require('metro-babel-transformer');

const fixtureSource = `${resolve(__dirname, 'src')}/`;
const sessionModule = join(resolve(__dirname, '../..'), 'packages/compiler/src/reflect/session.ts');

function transform(args) {
  let source = args.src;
  const filename = resolve(args.options.projectRoot, args.filename);
  if (filename.startsWith(fixtureSource)) {
    const capture = process.env.ZMDB_METRO_CAPTURE;
    if (capture && filename.endsWith('/index.ts')) writeFileSync(capture, source);

    const sessions = process.env.ZMDB_METRO_SESSIONS;
    if (sessions) {
      const { apiInstanceCount } = require(sessionModule);
      appendFileSync(
        sessions,
        `${JSON.stringify({ file: filename, pid: process.pid, sessions: apiInstanceCount() })}\n`,
      );
    }

    source += '\nglobalThis.__ZMDB_CUSTOM_TRANSFORMER__ = true;\n';
  }
  return delegate.transform({ ...args, src: source });
}

function getCacheKey(options) {
  return `consumer-metro:${delegate.getCacheKey(options)}`;
}

module.exports = { getCacheKey, transform };
