import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { compileProject, writeCompileResult } from '@zmdb/compiler';

const project = resolve('project');
const result = await compileProject({ project: join(project, 'tsconfig.json') });
assert.deepEqual(result.diagnostics, []);
assert.equal(result.artifacts.length, 1, 'the real compiler must emit the selected validator module');
const written = await writeCompileResult(result);
assert(written.written.some(path => path.endsWith('model.zmdb.generated.js')));
const source = await readFile(join(project, 'src/model.ts'), 'utf8');
const runtime = await readFile(join(project, 'src/model.zmdb.generated.js'), 'utf8');
assert.doesNotMatch(source + runtime, /@zmdb\/(?:aot-validator|schema-core|query-compiler|repository)/);
assert.match(source, /from ['"]\.\/model\.zmdb\.generated\.js['"]/);
const typed = spawnSync(
  resolve('node_modules/.bin/tsc'),
  [
    '-p',
    join(project, 'tsconfig.json'),
    '--noEmit',
    'false',
    '--outDir',
    join(project, 'compiled'),
    '--pretty',
    'false',
  ],
  { cwd: process.cwd(), encoding: 'utf8' },
);
assert.equal(typed.status, 0, typed.stdout + typed.stderr);
await mkdir(join(project, 'compiled'), { recursive: true });
await writeFile(join(project, 'compiled/model.zmdb.generated.js'), runtime);
