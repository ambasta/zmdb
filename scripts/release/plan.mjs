#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { releaseModel } from './model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function releasePlan(root, options) {
  return releaseModel(root, options).plan;
}

async function main(argv) {
  if (argv.length !== 1 || (argv[0] !== '--json' && argv[0] !== '--publish-tsv')) {
    console.error('usage: node scripts/release/plan.mjs <--json|--publish-tsv>');
    process.exitCode = 2;
    return;
  }
  const { loadGovernanceSnapshot } = await import('../architecture/governance.mjs');
  const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: ['release'] });
  const model = snapshot.queries.release;
  if (model === undefined) {
    throw new Error(snapshot.findings.map(item => item.line).join('\n') || 'release model is unavailable');
  }
  if (argv[0] === '--json') {
    console.log(JSON.stringify(model.plan, undefined, 2));
    return;
  }
  for (const entry of model.entries) console.log(`${entry.directory}\t${entry.npmName}`);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
