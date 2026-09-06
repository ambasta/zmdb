#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = [process.env.INIT_CWD, process.cwd(), process.env.PROJECT_CWD]
  .filter(candidate => candidate !== undefined)
  .map(candidate => resolve(candidate))
  .find(candidate => existsSync(join(candidate, 'docs-site', 'generated.mjs')));
if (root === undefined) throw new Error('could not locate docs-site/generated.mjs from the current Yarn project');
const { loadGovernanceSnapshot } = await import(
  pathToFileURL(join(root, 'scripts', 'architecture', 'governance.mjs')).href
);
const snapshot = await loadGovernanceSnapshot({ root, checks: ['release'] });
if (snapshot.architecture === null) throw new Error('governance snapshot has no architecture');
if (snapshot.queries.release === undefined) throw new Error('governance snapshot has no release model');
const generated = await import(pathToFileURL(join(root, 'docs-site', 'generated.mjs')).href);
const report = generated.checkGeneratedDocumentation(root, {
  architecture: snapshot.architecture,
  release: snapshot.queries.release,
});

if (report.problems.length > 0) {
  for (const problem of report.problems) console.error(`[ERROR] ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Generated documentation verified: ${String(report.packages)} packages, ${String(report.integrations)} framework integrations, and ${String(report.architectureDocuments)} architecture policy views.`,
  );
}
