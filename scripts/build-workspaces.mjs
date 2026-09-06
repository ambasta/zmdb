#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGovernanceSnapshot } from './architecture/governance.mjs';
import { topologicalOrder } from './architecture/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const YARN = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function fail(message) {
  process.stderr.write(`[build-workspaces] ${message}\n`);
  process.exit(1);
}

function runYarn(args, options = {}) {
  const result = spawnSync(YARN, args, {
    cwd: ROOT,
    encoding: options.capture === true ? 'utf8' : undefined,
    stdio: options.capture === true ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error !== undefined) fail(result.error.message);
  if (result.status !== 0) {
    fail(`yarn ${args.join(' ')} exited ${String(result.status)}`);
  }
  return result.stdout ?? '';
}

function readManifest(location) {
  const source = readFileSync(join(ROOT, location, 'package.json'), 'utf8');
  return JSON.parse(source);
}

function workspaceRows() {
  return runYarn(['workspaces', 'list', '--json'], { capture: true })
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function extraWorkspaceOrder(catalogNames) {
  const candidates = workspaceRows()
    .filter(row => row.location !== '.' && !catalogNames.has(row.name))
    .map(row => Object.freeze({ ...row, manifest: readManifest(row.location) }))
    .filter(row => typeof row.manifest.scripts?.build === 'string');
  const candidateNames = new Set(candidates.map(row => row.name));
  const graph = Object.fromEntries(
    candidates.map(row => [
      row.name,
      [
        ...new Set(
          DEPENDENCY_FIELDS.flatMap(field => {
            const dependencies = row.manifest[field];
            if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) return [];
            return Object.keys(dependencies).filter(name => candidateNames.has(name));
          }),
        ),
      ].toSorted(),
    ]),
  );
  const byName = new Map(candidates.map(row => [row.name, row]));
  return topologicalOrder(graph).map(name => byName.get(name));
}

const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: ['release'] });
const activeFindings = snapshot.findings.filter(finding => finding.disposition === 'active');
if (activeFindings.length > 0) {
  fail(`release governance is invalid:\n${activeFindings.map(finding => finding.line).join('\n')}`);
}
const release = snapshot.queries.release;
if (release === undefined) fail('release governance produced no release query');
const productTargets = release.entries.map(packageRecord => {
  if (typeof packageRecord.manifest.scripts?.build !== 'string') {
    fail(`${packageRecord.npmName} has no build script`);
  }
  return Object.freeze({
    location: packageRecord.directory,
    name: packageRecord.npmName,
    source: 'architecture',
  });
});
const catalogNames = new Set(productTargets.map(target => target.name));
const extraTargets = extraWorkspaceOrder(catalogNames).map(row =>
  Object.freeze({
    location: row.location,
    name: row.name,
    source: 'workspace',
  }),
);
const targets = Object.freeze([...productTargets, ...extraTargets]);

if (process.argv.slice(2).includes('--plan')) {
  process.stdout.write(`${JSON.stringify(targets, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(
  `Building ${String(productTargets.length)} product packages from the release dependency DAG` +
    ` and ${String(extraTargets.length)} additional build workspace(s).\n`,
);
for (const target of targets) {
  process.stdout.write(`\n[build-workspaces] ${target.name} (${target.source}: ${target.location})\n`);
  runYarn(['workspace', target.name, 'run', 'build']);
}
