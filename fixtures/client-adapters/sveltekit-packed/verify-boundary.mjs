import { strict as assert } from 'node:assert';

import { build } from 'esbuild';

const result = await build({
  entryPoints: ['client-boundary.mjs'],
  bundle: true,
  conditions: ['browser', 'import', 'default'],
  format: 'esm',
  logLevel: 'silent',
  platform: 'browser',
  write: false,
});
const output = result.outputFiles[0];
assert.ok(output);
const source = output.text;
assert.ok(source.length > 0);
assert.doesNotMatch(source, /createSvelteKitServerFetch/);
assert.doesNotMatch(source, /credentials:\s*["']omit["']/);
assert.doesNotMatch(source, /forwards .* explicit cookie allow-list/);

process.stdout.write(`${JSON.stringify({ browserBytes: output.contents.byteLength })}\n`);
