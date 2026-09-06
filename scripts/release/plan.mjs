#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { releaseModel } from './model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function releasePlan(root) {
  return releaseModel(root).plan;
}

function main(argv) {
  if (argv.length !== 1 || (argv[0] !== '--json' && argv[0] !== '--publish-tsv')) {
    console.error('usage: node scripts/release/plan.mjs <--json|--publish-tsv>');
    process.exitCode = 2;
    return;
  }
  const model = releaseModel(ROOT);
  if (argv[0] === '--json') {
    console.log(JSON.stringify(model.plan, undefined, 2));
    return;
  }
  for (const entry of model.entries) console.log(`${entry.directory}\t${entry.npmName}`);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
