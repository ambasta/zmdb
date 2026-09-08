#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadArchitecture } from '../../scripts/architecture/index.mjs';
import { createReleasePlan, releaseModel } from '../../scripts/release/model.mjs';
import { publishManifest } from './lib/publish-manifest.mjs';

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
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', readFileSync(path)));
  // oxlint-disable-next-line no-restricted-globals
  const base64 = typeof digest.toBase64 === 'function' ? digest.toBase64() : btoa(String.fromCharCode(...digest));
  return `sha512-${base64}`;
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

function verifyManifest(root, options, release) {
  const directory = resolve(root, options.directory);
  if (!isInside(root, directory)) fail(`${options.directory} escapes the repository root`);
  const entry = release.entries.find(
    candidate => candidate.directory === options.directory || resolve(root, candidate.directory) === directory,
  );
  if (entry === undefined) fail(`${options.directory} is absent from the release train`);
  if (entry.npmName !== options.packageName) {
    fail(`${options.directory} is governed as ${entry.npmName}, expected ${options.packageName}`);
  }
  const target =
    release.releasePolicy[entry.id].group === 'core'
      ? { kind: 'core', version: options.version }
      : { kind: 'package', id: entry.id, version: options.version };
  const plan = createReleasePlan(release, target);
  if (plan.version !== options.version || !plan.packages.includes(options.packageName)) {
    fail(`${options.packageName}@${options.version} is absent from the selected release plan`);
  }
  if (plan.changelogEntry.trim().length === 0) {
    fail(`CHANGELOG.md has no entry for ${plan.releaseId}@${options.version}`);
  }
  const manifest = entry.manifest;
  if (manifest.name !== options.packageName) {
    fail(`${options.directory} is ${String(manifest.name)}, expected ${options.packageName}`);
  }
  if (manifest.version !== options.version) {
    fail(`${options.packageName} is ${String(manifest.version)}, expected ${options.version}`);
  }
  return { directory, manifest };
}

async function publishPackage(root, options, release) {
  const { directory, manifest } = verifyManifest(root, options, release);
  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-release-pack-'));
  const stage = join(scratch, 'package');
  const packDestination =
    options.packDestination === undefined ? join(scratch, 'archives') : resolve(options.packDestination);
  try {
    mkdirSync(stage);
    for (const member of ['dist', 'src', 'README.md', 'LICENSE']) {
      cpSync(join(directory, member), join(stage, member), { recursive: true, dereference: true });
    }
    const ignore = join(directory, '.npmignore');
    if (existsSync(ignore)) cpSync(ignore, join(stage, '.npmignore'));
    const stagedManifest = publishManifest(manifest);
    // Staging already bounds the payload; a files allowlist overrides root .npmignore.
    delete stagedManifest.files;
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`);
    mkdirSync(packDestination, { recursive: true });
    const packed = runNpm(['pack', '--json', '--pack-destination', packDestination], { cwd: stage });
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

    if (options.dryRun) {
      console.log(JSON.stringify({ ...report, tarball, dryRun: true }, null, 2));
      return;
    }

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
    rmSync(scratch, { recursive: true, force: true });
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
  const root = resolve('.');
  const architecture = await loadArchitecture(root);
  const release = releaseModel(root, { architecture });
  await publishPackage(root, options, release);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
