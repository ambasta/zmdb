// Every published source file carries the MPL Exhibit A notice, because this project's files leave
// their directory constantly: the compiler inlines emitted code into consumer modules, the CLI writes
// generated clients into consumer repositories, and the documentation is full of copy-pasteable
// excerpts. A repository-root LICENSE alone would not travel with any of that.
//
// Two categories are deliberately excluded. Test fixtures are excluded because the lint rule suite
// asserts diagnostic line and column numbers against them, and a header would shift every position.
// Generated files are excluded because LICENSE-EXCEPTION.md states that compiler output is not
// Covered Software — stamping the notice into generated output would contradict the exception in the
// most visible place available.
//
// Usage: node scripts/license-headers.mjs [--check]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const HEADER = [
  '// This Source Code Form is subject to the terms of the Mozilla Public',
  '// License, v. 2.0. If a copy of the MPL was not distributed with this',
  '// file, You can obtain one at https://mozilla.org/MPL/2.0/.',
].join('\n');

/** The first header line is enough to detect: the notice is fixed text and never partially present. */
const MARKER = 'This Source Code Form is subject to the terms of the Mozilla Public';

function isExcluded(path) {
  // Fixtures: lint rule specs assert positions against these bytes.
  if (path.includes('__fixtures__/')) return true;
  // Generated output is not Covered Software; see LICENSE-EXCEPTION.md.
  if (/\.zmdb\.|\.generated\./.test(path)) return true;
  return false;
}

export function headerTargets(root = ROOT) {
  const tracked = execFileSync('git', ['ls-files', 'packages/*/src/*', 'packages/*/src/**'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
  return tracked.filter(path => path.endsWith('.ts') && !isExcluded(path));
}

/** Returns the file with the notice attached, or undefined when it already carries one. */
export function withHeader(source) {
  if (source.includes(MARKER)) return undefined;
  // A shebang must stay on line one, so the notice goes directly beneath it.
  if (source.startsWith('#!')) {
    const breakAt = source.indexOf('\n');
    const shebang = breakAt === -1 ? source : source.slice(0, breakAt);
    const rest = breakAt === -1 ? '' : source.slice(breakAt + 1).replace(/^\n+/, '');
    return `${shebang}\n${HEADER}\n\n${rest}`;
  }
  return `${HEADER}\n\n${source.replace(/^\n+/, '')}`;
}

function run(root, check) {
  const missing = [];
  let written = 0;
  for (const path of headerTargets(root)) {
    const full = join(root, path);
    const source = readFileSync(full, 'utf8');
    const next = withHeader(source);
    if (next === undefined) continue;
    if (check) missing.push(path);
    else {
      writeFileSync(full, next);
      written += 1;
    }
  }
  if (check && missing.length > 0) {
    console.error(`Missing the MPL Exhibit A notice in ${missing.length} file(s):`);
    for (const path of missing) console.error(`  ${path}`);
    console.error('\nRun `node scripts/license-headers.mjs` to attach it.');
    return 1;
  }
  console.log(
    check ? 'Every published source file carries the MPL notice.' : `MPL notice attached to ${written} file(s).`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rest = process.argv.slice(2).filter(argument => argument !== '--check');
  if (rest.length > 0) {
    console.error('usage: node scripts/license-headers.mjs [--check]');
    process.exitCode = 2;
  } else {
    process.exitCode = run(ROOT, process.argv.includes('--check'));
  }
}
