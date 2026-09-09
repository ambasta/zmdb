import { readFile } from 'node:fs/promises';

import { zmdbAot } from '@zmdb/core/compiler';
import { build } from 'esbuild';

const [entry, outfile] = process.argv.slice(2);
if (entry === undefined || outfile === undefined) {
  throw new Error('usage: node build.mjs <entry> <outfile>');
}

const compiler = await zmdbAot({ cwd: process.cwd() });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  packages: 'external',
  platform: 'node',
  target: 'node26',
  logLevel: 'silent',
  plugins: [
    {
      name: compiler.name,
      setup(esbuild) {
        esbuild.onLoad({ filter: /\.[cm]?tsx?$/ }, async ({ path }) => {
          const code = await readFile(path, 'utf8');
          const transformed = await compiler.transform(code, path);
          return {
            contents: transformed?.code ?? code,
            loader: path.endsWith('x') ? 'tsx' : 'ts',
          };
        });
        esbuild.onEnd(() => compiler.buildEnd?.());
      },
    },
  ],
});
