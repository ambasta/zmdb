import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const badRoute = join(ROOT, 'app', 'bad-boundary');
const nextOutput = join(ROOT, '.next');
const serverSource = readFileSync(join(ROOT, 'node_modules', '@zmdb', 'next', 'dist', 'server.js'), 'utf8');
const clientSource = readFileSync(join(ROOT, 'node_modules', '@zmdb', 'next', 'dist', 'client.js'), 'utf8');

if (!serverSource.startsWith("import 'server-only';")) {
  throw new Error('packed @zmdb/next/server lost its server-only first import');
}
if (!clientSource.startsWith("'use client';")) {
  throw new Error('packed @zmdb/next/client lost its use-client directive');
}

const plainImport = spawnSync(
  process.execPath,
  ['--input-type=module', '--eval', "await import('@zmdb/next/server')"],
  { cwd: ROOT, encoding: 'utf8' },
);
if (plainImport.status === 0) throw new Error('plain Node imported the guarded @zmdb/next/server entry');
if (!plainImport.stderr.includes('This module cannot be imported from a Client Component module')) {
  throw new Error(`plain server guard failed for an unexpected reason:\n${plainImport.stderr}`);
}

const serverImport = spawnSync(
  process.execPath,
  ['--conditions=react-server', '--input-type=module', '--eval', "await import('@zmdb/next/server')"],
  { cwd: ROOT, encoding: 'utf8' },
);
if (serverImport.status !== 0) {
  throw new Error(`react-server import failed:\n${serverImport.stdout}\n${serverImport.stderr}`);
}

mkdirSync(badRoute, { recursive: true });
writeFileSync(
  join(badRoute, 'page.tsx'),
  `'use client';

import { createNextServerClient } from '@zmdb/next/server';

export default function BadBoundary() {
  return <pre>{typeof createNextServerClient}</pre>;
}
`,
);
const boundaryBuild = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
rmSync(badRoute, { recursive: true, force: true });
rmSync(nextOutput, { recursive: true, force: true });
const boundaryOutput = `${boundaryBuild.stdout}\n${boundaryBuild.stderr}`;
if (boundaryBuild.status === 0) throw new Error('Next built a client component that imported @zmdb/next/server');
if (!/server-only|Client Component|Server Component/u.test(boundaryOutput)) {
  throw new Error(`Next rejected the boundary for an unexpected reason:\n${boundaryOutput}`);
}

process.stdout.write(
  JSON.stringify({
    plainNode: 'rejected',
    reactServer: 'imported',
    nextClientBuild: 'rejected',
  }),
);
