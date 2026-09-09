import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import type { AdapterPackageExpectation } from './package-matrix.js';

interface AdapterImportProbeResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function adapterExportSpecifiers(expectation: AdapterPackageExpectation): readonly string[] {
  return expectation.exports.map(subpath =>
    subpath === '.' ? expectation.name : `${expectation.name}/${subpath.slice('./'.length)}`,
  );
}

function commandOutput(value: string | Buffer | null | undefined): string {
  return typeof value === 'string' ? value : (value?.toString() ?? '');
}

function importProbeSource(
  specifiers: readonly string[],
  requiredPeers: readonly string[],
  allowedGlobals: readonly string[],
): string {
  return `
for (const specifier of ${JSON.stringify(requiredPeers)}) {
  try {
    import.meta.resolve(specifier);
    await import(specifier);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
}
const before = new Set(Reflect.ownKeys(globalThis));
const allowed = new Set(${JSON.stringify(allowedGlobals)});
let requests = 0;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value() {
    requests += 1;
    throw new Error('adapter import attempted network I/O');
  },
});
for (const specifier of ${JSON.stringify(specifiers)}) {
  await import(specifier);
}
const added = Reflect.ownKeys(globalThis)
  .filter(key => !before.has(key) && key !== 'fetch' && !allowed.has(String(key)))
  .map(String);
if (requests !== 0) throw new Error('adapter import executed network I/O');
if (added.length !== 0) throw new Error('adapter import registered globals: ' + added.join(', '));
`;
}

function runImportProbe(
  root: string,
  specifiers: readonly string[],
  requiredPeers: readonly string[],
  allowedGlobals: readonly string[],
  conditions: readonly string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      ...conditions.map(condition => `--conditions=${condition}`),
      `--import=${join(root, 'scripts', 'ts-specifier-hook.mjs')}`,
      '--input-type=module',
      '--eval',
      importProbeSource(specifiers, requiredPeers, allowedGlobals),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

function probeAdapterImports(root: string, expectation: AdapterPackageExpectation): AdapterImportProbeResult {
  const specifiers = adapterExportSpecifiers(expectation);
  const requiredPeers = Object.keys(expectation.peerDependencies)
    .filter(name => !expectation.optionalPeers.includes(name))
    .toSorted();
  const importProbePeers = expectation.importProbePeers ?? requiredPeers;
  const allowedGlobals = expectation.allowedImportGlobals ?? [];
  if (expectation.name !== '@zmdb/next') {
    const result = runImportProbe(root, specifiers, importProbePeers, allowedGlobals);
    return {
      status: result.status ?? 1,
      stdout: commandOutput(result.stdout),
      stderr: commandOutput(result.stderr),
    };
  }

  const clientSpecifiers = specifiers.filter(specifier => specifier !== '@zmdb/next/server');
  const client = runImportProbe(root, clientSpecifiers, importProbePeers, allowedGlobals);
  const server = runImportProbe(root, ['@zmdb/next/server'], [], allowedGlobals, ['react-server']);
  const guarded = spawnSync(
    process.execPath,
    [
      `--import=${join(root, 'scripts', 'ts-specifier-hook.mjs')}`,
      '--input-type=module',
      '--eval',
      "await import('@zmdb/next/server')",
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  const guardStderr = commandOutput(guarded.stderr);
  const guardWorked =
    guarded.status !== 0 && guardStderr.includes('This module cannot be imported from a Client Component module');
  const status = client.status === 0 && server.status === 0 && guardWorked ? 0 : 1;
  return {
    status,
    stdout: [client.stdout, server.stdout, guarded.stdout].map(commandOutput).filter(Boolean).join('\n'),
    stderr: [client.stderr, server.stderr, guardWorked ? '' : `plain @zmdb/next/server guard result:\n${guardStderr}`]
      .map(commandOutput)
      .filter(Boolean)
      .join('\n'),
  };
}

export function assertAdapterImportsWithoutEffects(root: string, expectation: AdapterPackageExpectation): void {
  const result = probeAdapterImports(root, expectation);
  if (result.status === 0) return;
  throw new Error(
    `${expectation.name} import-side-effect probe failed with ${String(result.status)}\n${result.stdout}\n${result.stderr}`,
  );
}
