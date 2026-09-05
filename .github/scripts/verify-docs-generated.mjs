#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = [process.env.INIT_CWD, process.cwd(), process.env.PROJECT_CWD]
  .filter(candidate => candidate !== undefined)
  .map(candidate => resolve(candidate))
  .find(candidate => existsSync(join(candidate, 'docs-site', 'generated.mjs')));
if (root === undefined) throw new Error('could not locate docs-site/generated.mjs from the current Yarn project');
const generated = await import(pathToFileURL(join(root, 'docs-site', 'generated.mjs')).href);
const report = generated.checkGeneratedDocumentation(root);

if (report.problems.length > 0) {
  for (const problem of report.problems) console.error(`[ERROR] ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Generated documentation verified: ${String(report.packages)} packages and ${String(report.integrations)} framework integrations.`,
  );
}
