#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(message) {
  throw new Error(message);
}

function isInside(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function output(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function runNpm(arguments_, options = {}) {
  return spawnSync('npm', arguments_, {
    encoding: 'utf8',
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    ...options,
  });
}

export function parsePackReport(source) {
  const parsed = JSON.parse(source);
  const report = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (typeof report !== 'object' || report === null || typeof report.filename !== 'string') {
    fail('npm pack returned no package report');
  }
  return report;
}

export function parseRegistryIntegrity(source) {
  const parsed = JSON.parse(source);
  if (typeof parsed !== 'string' || !parsed.startsWith('sha512-')) {
    fail(`npm view returned invalid dist.integrity ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

export function isRegistryMiss(result) {
  return result.status !== 0 && /\bE404\b|404 Not Found|is not in this registry/i.test(output(result));
}

async function fileIntegrity(path) {
  const digest = await globalThis.crypto.subtle.digest('SHA-512', readFileSync(path));
  return `sha512-${new Uint8Array(digest).toBase64()}`;
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') return { selfTest: true };
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) fail(`${argument} requires a value`);
    if (argument === '--directory') options.directory = value;
    else if (argument === '--package') options.packageName = value;
    else if (argument === '--pack-destination') options.packDestination = value;
    else if (argument === '--tag') options.tag = value;
    else if (argument === '--version') options.version = value;
    else fail(`unknown argument ${argument}`);
  }
  for (const [field, flag] of [
    ['directory', '--directory'],
    ['packageName', '--package'],
    ['tag', '--tag'],
    ['version', '--version'],
  ]) {
    if (typeof options[field] !== 'string' || options[field].length === 0) fail(`${flag} is required`);
  }
  return { ...options, selfTest: false };
}

function verifyManifest(root, options) {
  const directory = resolve(root, options.directory);
  if (!isInside(root, directory)) fail(`${options.directory} escapes the repository root`);
  const manifestPath = join(directory, 'package.json');
  if (!existsSync(manifestPath)) fail(`${options.directory}/package.json does not exist`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== options.packageName) {
    fail(`${options.directory} is ${String(manifest.name)}, expected ${options.packageName}`);
  }
  if (manifest.version !== options.version) {
    fail(`${options.packageName} is ${String(manifest.version)}, expected ${options.version}`);
  }
  return directory;
}

async function publishPackage(root, options) {
  const directory = verifyManifest(root, options);
  if (options.dryRun) {
    const packed = runNpm(['pack', '--dry-run'], { cwd: directory, stdio: 'inherit' });
    if (packed.status !== 0) fail(`npm pack --dry-run failed for ${options.packageName}`);
    return;
  }

  const ownedDestination = options.packDestination === undefined;
  const packDestination =
    options.packDestination === undefined
      ? mkdtempSync(join(tmpdir(), 'zmdb-release-pack-'))
      : resolve(options.packDestination);
  try {
    mkdirSync(packDestination, { recursive: true });
    const packed = runNpm(['pack', '--json', '--pack-destination', packDestination], { cwd: directory });
    if (packed.status !== 0) fail(`npm pack failed for ${options.packageName}: ${output(packed)}`);
    const report = parsePackReport(packed.stdout);
    if (report.name !== undefined && report.name !== options.packageName) {
      fail(`npm pack reported ${String(report.name)}, expected ${options.packageName}`);
    }
    if (report.version !== undefined && report.version !== options.version) {
      fail(`npm pack reported ${String(report.version)}, expected ${options.version}`);
    }
    const tarball = join(packDestination, report.filename);
    const localIntegrity =
      typeof report.integrity === 'string' && report.integrity.startsWith('sha512-')
        ? report.integrity
        : await fileIntegrity(tarball);

    const registry = runNpm(['view', `${options.packageName}@${options.version}`, 'dist.integrity', '--json'], {
      cwd: root,
    });
    if (registry.status === 0) {
      const registryIntegrity = parseRegistryIntegrity(registry.stdout);
      if (registryIntegrity !== localIntegrity) {
        fail(
          `[RELEASE_EXISTING_MISMATCH] ${options.packageName}@${options.version}: registry integrity ${registryIntegrity} disagrees with local ${localIntegrity}. Remediation: stop and investigate the immutable registry conflict rather than overwriting.`,
        );
      }
      console.log(`${options.packageName}@${options.version} already exists with identical bytes; skipping.`);
      return;
    }
    if (!isRegistryMiss(registry)) {
      fail(`cannot inspect ${options.packageName}@${options.version}: ${output(registry)}`);
    }

    const published = runNpm(['publish', tarball, '--access', 'public', '--tag', options.tag], {
      cwd: root,
      stdio: 'inherit',
    });
    if (published.status !== 0) fail(`npm publish failed for ${options.packageName}@${options.version}`);
  } finally {
    if (ownedDestination) rmSync(packDestination, { recursive: true, force: true });
  }
}

function selfTest() {
  const integrity = 'sha512-YWJj';
  if (parseRegistryIntegrity(JSON.stringify(integrity)) !== integrity) fail('registry integrity parser drifted');
  if (
    !isRegistryMiss({
      status: 1,
      stdout: '',
      stderr: 'npm error code E404\nnpm error 404 Not Found',
    })
  ) {
    fail('registry E404 detection drifted');
  }
  const report = parsePackReport(JSON.stringify([{ filename: 'fixture.tgz', integrity }]));
  if (report.filename !== 'fixture.tgz' || report.integrity !== integrity) fail('pack report parser drifted');
  console.log('Publish-package self-test passed: pack reports, registry integrity, and E404 detection are strict.');
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.selfTest) {
    selfTest();
    return;
  }
  await publishPackage(resolve('.'), options);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
