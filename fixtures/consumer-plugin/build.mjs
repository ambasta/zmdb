// The bundler half of the pair: esbuild, with zmdb's transform in front of it.
//
// `zmdbAot()` returns a plain unplugin object — `{ name, enforce, transform(code, id) }` —
// rather than an esbuild plugin, which is why there are twenty lines here instead of one
// import. That is the honest shape of the integration: unplugin's adapters exist and work,
// but `@zmdb/compiler` does not depend on unplugin, so a consumer either installs it or
// writes the fifteen-line `onLoad` below. Both are supported; this fixture takes the second
// route so that nothing but esbuild is between the source and the bundle.
//
// `enforce: 'pre'` is the reason the hook is `onLoad` and reads the file itself. The transform
// rewrites at byte offsets taken from the AST the TypeScript compiler parsed, so it has to see
// the file's own text — anything that got there first would leave every offset pointing at the
// wrong byte, and the failure mode is a silent fall back to the runtime walker rather than an
// error.

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { zmdbAot } from 'zmdb/compiler';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = process.argv[2] ?? join(here, 'dist');
const plugin = await zmdbAot({ cwd: here });
const sourceRoot = join(here, 'src');

/** `plugin.transform` as an esbuild plugin. The whole adapter. */
const asEsbuildPlugin = unplugin => ({
  name: unplugin.name,
  setup(esbuild) {
    esbuild.onLoad({ filter: /\.[cm]?tsx?$/ }, async ({ path }) => {
      const code = await readFile(path, 'utf8');
      const sourcePath = relative(sourceRoot, path);
      const isProjectSource = !isAbsolute(sourcePath) && sourcePath !== '..' && !sourcePath.startsWith(`..${sep}`);
      const result = isProjectSource ? unplugin.transform(code, path) : null;
      return { contents: result ? result.code : code, loader: 'ts' };
    });
    esbuild.onEnd(() => unplugin.buildEnd?.());
  },
});

// Two entry points in one build, so there is one compiler session rather than two:
// `probe.mjs` is the program, and `orders.mjs` is the same modules bundled without the
// program around them, which is what the fixture test reads the emitted checks out of.
await build({
  entryPoints: [join(here, 'src', 'probe.ts'), join(here, 'src', 'orders.ts')],
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node26',
  // Nothing is marked external. The point of the fixture is what ends up in the bundle, and a
  // dependency left outside it would be a dependency nobody looked at.
  plugins: [asEsbuildPlugin(plugin)],
  logLevel: 'silent',
});

process.stdout.write(`${outdir}\n`);
