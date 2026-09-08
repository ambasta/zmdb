import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
if (!process.argv[2]) throw new Error('Usage: node benchmarks/rca/http/prepare.mjs <output directory>');
const out = path.resolve(process.argv[2]);
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const artifacts = path.join(out, 'artifacts');
await mkdir(artifacts, { recursive: true });
const tooling = path.join(out, 'tooling');
const peers = { fastify: '5.12.3', elysia: '1.4.30', hono: '4.13.7' };
await mkdir(tooling, { recursive: true });
await writeFile(
  path.join(tooling, 'package.json'),
  JSON.stringify({ name: 'zmdb-http-rca-tools', private: true, type: 'module', dependencies: peers }, null, 2) + '\n',
);
let install = false;
for (const [name, version] of Object.entries(peers)) {
  try {
    install ||=
      JSON.parse(await readFile(path.join(tooling, 'node_modules', name, 'package.json'), 'utf8')).version !== version;
  } catch {
    install = true;
  }
}
if (install)
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: tooling, stdio: 'inherit' });
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2024',
  sourcemap: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  metafile: true,
};

for (const [name, entry] of [
  ['zmdb', 'benchmarks/rca/http/workload.ts'],
  ['validator', 'benchmarks/harness/framework/model.ts'],
]) {
  const result = await build({ ...common, entryPoints: [entry], outfile: path.join(artifacts, `${name}.mjs`) });
  await writeFile(path.join(artifacts, `${name}.meta.json`), JSON.stringify(result.metafile, null, 2) + '\n');
}
await build({
  ...common,
  stdin: { contents: "export { Hono } from 'hono';", resolveDir: tooling, sourcefile: 'hono-entry.mjs' },
  outfile: path.join(artifacts, 'hono.mjs'),
});
const versions = {};
for (const name of ['fastify', 'elysia', 'hono']) {
  const manifest = JSON.parse(await readFile(path.join(out, 'tooling/node_modules', name, 'package.json'), 'utf8'));
  versions[name] = manifest.version;
}
const hashes = {};
for (const relative of [
  'benchmarks/rca/http/workload.ts',
  'benchmarks/harness/framework/model.ts',
  'benchmarks/harness/framework/model.zmdb.generated.js',
  'packages/web/src/pipeline/index.ts',
  'packages/app/src/data/index.ts',
]) {
  hashes[relative] = new Uint8Array(
    await crypto.subtle.digest('SHA-256', await readFile(path.join(root, relative))),
  ).toHex();
}
await writeFile(
  path.join(out, 'tsconfig.workload.json'),
  JSON.stringify(
    {
      extends: path.join(root, 'tsconfig.json'),
      compilerOptions: {
        rootDir: root,
        noEmit: true,
        skipLibCheck: false,
        incremental: false,
        composite: false,
        typeRoots: [path.join(root, 'node_modules/@types')],
      },
      include: [path.join(root, 'benchmarks/rca/http/workload.ts')],
      exclude: [],
    },
    null,
    2,
  ) + '\n',
);
const report = {
  root,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  preparedAt: new Date().toISOString(),
  node: process.version,
  esbuild: require('esbuild').version,
  peers: versions,
  mode: 'public source bundle; same generated AOT UserCreate validator for every JSON workload',
  sources: hashes,
};
await writeFile(path.join(out, 'prepared.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
