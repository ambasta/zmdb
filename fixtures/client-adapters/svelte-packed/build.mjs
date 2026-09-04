import { strict as assert } from 'node:assert';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';

const root = dirname(fileURLToPath(import.meta.url));
const generated = join(root, 'generated');
const dist = join(root, 'dist');
const sources = ['Child.svelte', 'App.svelte'];

rmSync(generated, { recursive: true, force: true });
rmSync(dist, { recursive: true, force: true });

for (const target of ['client', 'server']) {
  const directory = join(generated, target);
  mkdirSync(directory, { recursive: true });
  cpSync(join(root, 'bindings.mjs'), join(directory, 'bindings.mjs'));
  for (const source of sources) {
    const output = compile(readFileSync(join(root, source), 'utf8'), {
      filename: join(root, source),
      generate: target,
      dev: false,
    });
    writeFileSync(join(directory, `${source}.js`), output.js.code);
  }
}

mkdirSync(dist, { recursive: true });
await build({
  entryPoints: [join(generated, 'client', 'App.svelte.js')],
  bundle: true,
  conditions: ['browser', 'import', 'default'],
  format: 'esm',
  logLevel: 'silent',
  outfile: join(dist, 'app.js'),
  platform: 'browser',
});

const namespace = await import(`${pathToFileURL(join(generated, 'server', 'App.svelte.js')).href}?packed=1`);
assert.equal(typeof namespace.default, 'function');
const first = render(namespace.default, { props: { client: { label: 'first-request' } } }).body;
const second = render(namespace.default, { props: { client: { label: 'second-request' } } }).body;
assert.match(first, /first-request/);
assert.doesNotMatch(first, /second-request/);
assert.match(second, /second-request/);
assert.doesNotMatch(second, /first-request/);

process.stdout.write(
  `${JSON.stringify({
    browserBytes: statSync(join(dist, 'app.js')).size,
    serverRenders: [first.includes('first-request'), second.includes('second-request')],
  })}\n`,
);
