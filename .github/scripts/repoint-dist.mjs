// Repoint each package's exports/main/types/bin/files at the built dist. This runs IN
// CI ONLY, right before publish — the committed package.json keeps `exports` on
// `./src/**.ts` so local dev, vitest and the consumer fixtures resolve TypeScript
// source.
//
// The rewrite itself lives in `./lib/publish-manifest.mjs`, shared with
// `verify-publish.mjs`, which stages the same manifest into a throwaway
// `node_modules` and imports every subpath out of it. This script adds one thing on
// top: it checks that each target actually exists in `dist`, because a manifest that
// points at a file `yarn build` did not produce publishes fine and fails on install.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { releaseTargetFromTag } from '../../scripts/release/plan.mjs';
import { ROOT, publishManifest, publishTrain } from './lib/publish-manifest.mjs';

const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex === -1 ? undefined : process.argv[tagIndex + 1];
if (tag === undefined || process.argv.length !== 4) {
  throw new Error('usage: node .github/scripts/repoint-dist.mjs --tag <release-id>-v<version>');
}
const release = await publishTrain(ROOT, releaseTargetFromTag(tag));
let missing = 0;
for (const packageRecord of release.packages) {
  const pkgDir = join(ROOT, packageRecord.directory);
  const pkgPath = join(pkgDir, 'package.json');
  const pkg = publishManifest(packageRecord.manifest);

  for (const [subpath, exportEntry] of Object.entries(pkg.exports)) {
    for (const target of [exportEntry.types, exportEntry.import]) {
      if (!existsSync(join(pkgDir, target))) {
        console.error(`[ERROR] ${pkg.name} export "${subpath}" → ${target} does not exist. Did \`yarn build\` run?`);
        missing++;
      }
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`repointed ${pkg.name} → dist (${Object.keys(pkg.exports).length} entries)`);
}

if (missing > 0) {
  console.error(`\n${missing} export target(s) missing from dist`);
  process.exit(1);
}
console.log('DONE — package.json now points at dist (CI publish state)');
