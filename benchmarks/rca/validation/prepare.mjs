import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveSources, root } from './runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const evidence = resolve(process.argv[2]);
const tooling = join(evidence, 'tooling');
const generated = join(evidence, 'generated');
const versions = {
  typia: '14.0.5',
  ttsc: '0.29.0',
  typescript: '7.0.2',
  typebox: '1.3.29',
  ajv: '8.20.0',
  'fast-json-stringify': '7.0.1',
};
mkdirSync(tooling, { recursive: true });
const manifestPath = join(tooling, 'package.json');
if (!existsSync(manifestPath)) {
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ private: true, type: 'module', dependencies: versions }, null, 2)}\n`,
  );
}
assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies, versions);
if (!existsSync(join(tooling, 'node_modules/typia/package.json'))) {
  runCommand(
    'npm',
    [existsSync(join(tooling, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'],
    tooling,
  );
}
const requirePeer = await resolveSources(evidence);
const packages = Object.fromEntries(
  Object.keys(versions).map(name => [
    name,
    JSON.parse(readFileSync(join(tooling, 'node_modules', name, 'package.json'), 'utf8')).version,
  ]),
);
assert.deepEqual(packages, versions);
mkdirSync(generated, { recursive: true });
if (!existsSync(join(evidence, 'node_modules')))
  symlinkSync(join(tooling, 'node_modules'), join(evidence, 'node_modules'));
const [{ ReflectSession }, { transformFile }, { findCallSites }, { Reflector }, { jsonSchemaFromTypeIR }] =
  await Promise.all([
    import(pathToFileURL(join(root, 'packages/compiler/src/reflect/session.ts')).href),
    import(pathToFileURL(join(root, 'packages/compiler/src/transform/index.ts')).href),
    import(pathToFileURL(join(root, 'packages/compiler/src/reflect/callsites.ts')).href),
    import(pathToFileURL(join(root, 'packages/compiler/src/reflect/index.ts')).href),
    import(pathToFileURL(join(root, 'packages/schema/src/ir/index.ts')).href),
  ]);
for (const name of ['model.ts', 'zmdb-source.ts', 'typia-source.ts'])
  copyFileSync(join(here, name), join(generated, name));
writeFileSync(join(generated, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
const compilerOptions = {
  strict: true,
  target: 'ESNext',
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  skipLibCheck: true,
  noEmit: false,
  outDir: './typia',
  plugins: [{ transform: 'typia/lib/transform' }],
};
writeFileSync(
  join(generated, 'tsconfig.typia.json'),
  JSON.stringify({ compilerOptions, files: ['model.ts', 'typia-source.ts'] }),
);
writeFileSync(
  join(generated, 'tsconfig.zmdb.json'),
  JSON.stringify({
    extends: join(root, 'tsconfig.json'),
    compilerOptions: { noEmit: true },
    files: ['model.ts', 'zmdb-source.ts'],
    include: [],
    exclude: [],
  }),
);
using session = ReflectSession.open({ project: join(generated, 'tsconfig.zmdb.json') });
const source = join(generated, 'zmdb-source.ts');
assert.deepEqual(session.diagnostics(source), []);
const sourceFile = session.sourceFile(source);
const [site] = findCallSites(sourceFile, new Set(['is']));
const reflector = new Reflector(session.checker, sourceFile, {});
const ir = reflector.typeIR(session.checker.getTypeFromTypeNode(site.typeArgument));
assert.deepEqual(reflector.diagnostics, []);
writeFileSync(join(generated, 'schema.json'), `${JSON.stringify(jsonSchemaFromTypeIR(ir), null, 2)}\n`);
const result = transformFile(source, readFileSync(source, 'utf8'), { session });
assert.deepEqual(result.diagnostics, []);
assert.equal(result.changed, true);
const emitted = stripTypeScriptTypes(result.code, { mode: 'strip' });
writeFileSync(join(generated, 'zmdb.mjs'), emitted);
const ttscPackage = requirePeer('ttsc/package.json');
const ttsc = join(dirname(requirePeer.resolve('ttsc/package.json')), ttscPackage.bin.ttsc);
const output = runCommand(process.execPath, [ttsc, '-p', join(generated, 'tsconfig.typia.json')], generated);
writeFileSync(join(evidence, 'typia-build.log'), output);
assert.doesNotMatch(
  readFileSync(join(generated, 'typia/typia-source.js'), 'utf8'),
  /typia\.(?:createIs|createEquals|json\.createStringify)\(/,
);
const inputs = {};
for (const filename of [
  'model.ts',
  'zmdb-source.ts',
  'typia-source.ts',
  'schema.json',
  'zmdb.mjs',
  'typia/typia-source.js',
]) {
  const data = readFileSync(join(generated, filename));
  inputs[filename] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
const receipt = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version,
  packages,
  inputs,
};
writeFileSync(join(evidence, 'prepared.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);

function runCommand(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 180000, detached: true });
  } catch (error) {
    if (Number.isInteger(error.pid) && error.pid > 0) {
      try {
        process.kill(-error.pid, 'SIGTERM');
      } catch (cleanup) {
        if (cleanup.code !== 'ESRCH') throw cleanup;
      }
    }
    throw error;
  }
}
