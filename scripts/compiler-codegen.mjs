#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';

import { loadConfig } from '../packages/compiler/src/config/index.js';
import { compileProject, writeCompileResult } from '../packages/compiler/src/index.js';

const args = process.argv.slice(2);
let projectOverride;
let configPath;
let check = false;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--check') {
    check = true;
    continue;
  }
  if (argument === '--project') {
    const value = args[index + 1];
    if (value === undefined) throw new TypeError('--project needs a path');
    projectOverride = resolve(value);
    index += 1;
    continue;
  }
  if (argument === '--config') {
    const value = args[index + 1];
    if (value === undefined) throw new TypeError('--config needs a path');
    configPath = value;
    index += 1;
    continue;
  }
  throw new TypeError(`unknown compiler-codegen option ${String(argument)}`);
}

const cwd = process.cwd();
const configCwd = configPath === undefined && projectOverride !== undefined ? dirname(projectOverride) : cwd;
const config = await loadConfig({
  cwd: configCwd,
  ...(configPath === undefined ? { optional: true } : { path: configPath }),
});
const project = projectOverride ?? config?.project ?? join(cwd, 'tsconfig.json');
const result = await compileProject({
  project,
  ...(config === undefined ? {} : { naming: config.resolvedNaming }),
});
if (result.diagnostics.length > 0) {
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic.code}: ${diagnostic.message}\n`);
  }
  process.exitCode = 1;
} else {
  const written = await writeCompileResult(result, { check });
  if (check && written.stale.length > 0) {
    for (const path of written.stale) process.stderr.write(`stale ${path}\n`);
    process.exitCode = 1;
  }
}
