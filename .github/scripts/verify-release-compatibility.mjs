import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { cleanEnvironment, command, startRegistry } from '../../fixtures/consumer-cli/registry.mjs';
import { CONSUMER_CASES } from '../../fixtures/consumer-release-compatibility/cases.mjs';
import { compareSemver, parseSemver, rangeFloor, satisfiesRange } from '../../scripts/release/lib.mjs';
import { RELEASE_PACKAGE_POLICY } from '../../scripts/release/policy.mjs';
import { publishCatalog, publishManifest } from './lib/publish-manifest.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const official = name => name.startsWith('@zmdb/');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const manifestsAt = root =>
  Object.fromEntries(
    Object.keys(RELEASE_PACKAGE_POLICY).map(id => [id, json(join(root, 'packages', id, 'package.json'))]),
  );
const nextVersion = version => `${version.split('-')[0]}-compatibility.1`;
const required = manifest => ({
  ...manifest.dependencies,
  ...Object.fromEntries(
    Object.entries(manifest.peerDependencies ?? {}).filter(
      ([name]) => !manifest.peerDependenciesMeta?.[name]?.optional,
    ),
  ),
});

function officialClosure(manifests, roots) {
  const byName = new Map(Object.entries(manifests).map(([id, manifest]) => [manifest.name, id]));
  const seen = new Set();
  const visit = id => {
    assert(manifests[id], `unknown release unit ${id}`);
    if (seen.has(id)) return;
    seen.add(id);
    for (const name of Object.keys(required(manifests[id]))) if (official(name)) visit(byName.get(name));
  };
  roots.forEach(visit);
  return [...seen];
}

function selectedInputs(root, manifests, id) {
  const fixture = CONSUMER_CASES[id];
  assert(fixture, `${id}: physical consumer missing`);
  const roots = [id, ...fixture.roots];
  const selection = Object.fromEntries(roots.map(key => [manifests[key].name, manifests[key].version]));
  for (const key of officialClosure(manifests, roots))
    for (const [name, peer] of Object.entries(RELEASE_PACKAGE_POLICY[key].peers)) selection[name] = peer.floor;
  for (const [name, owner] of Object.entries(fixture.peers)) {
    const version =
      owner === 'fixture'
        ? json(join(root, 'fixtures/consumer-server-integrations', id, 'package.json')).dependencies[name]
        : RELEASE_PACKAGE_POLICY[owner]?.peers[name]?.floor;
    assert(parseSemver(version), `${id}: unversioned fixture peer ${name}`);
    selection[name] = version;
  }
  return selection;
}

/** Derive version cases from release policy; fixtures only identify executable consumers. */
export function releaseCompatibilityPlan(root = ROOT) {
  const manifests = manifestsAt(root);
  const cases = [];
  for (const [id, policy] of Object.entries(RELEASE_PACKAGE_POLICY)) {
    const selected = selectedInputs(root, manifests, id);
    const vectors = [selected];
    for (const [dependency, peer] of Object.entries(policy.peers))
      for (const version of new Set([peer.floor, ...peer.tested])) vectors.push({ ...selected, [dependency]: version });
    for (const [index, selection] of [
      ...new Map(vectors.map(value => [JSON.stringify(value), value])).values(),
    ].entries())
      cases.push({ id: `${id}:supported:${index}`, packageId: id, kind: 'supported', selection });
    for (const [dependency, peer] of Object.entries(policy.peers))
      cases.push({
        id: `${id}:below-floor:${dependency}`,
        packageId: id,
        kind: 'below-floor',
        selection: { ...selected, [dependency]: `<${peer.floor}` },
        constraint: { owner: manifests[id].name, dependency, range: peer.range },
      });
  }
  const integration = Object.keys(RELEASE_PACKAGE_POLICY).find(
    id => RELEASE_PACKAGE_POLICY[id].group === 'integration',
  );
  assert(integration, 'no independently releasable integration');
  cases.push({
    id: `${integration}:independent-integration`,
    packageId: integration,
    kind: 'independent-integration',
    selection: {
      ...selectedInputs(root, manifests, integration),
      [manifests[integration].name]: nextVersion(manifests[integration].version),
    },
  });
  const mismatch = Object.entries(manifests).flatMap(([id, manifest]) =>
    Object.entries(manifest.peerDependencies ?? {}).flatMap(([name, range]) => {
      const coreId = Object.keys(manifests).find(
        key => manifests[key].name === name && RELEASE_PACKAGE_POLICY[key].group === 'core',
      );
      return coreId && !manifest.peerDependenciesMeta?.[name]?.optional ? [{ id, manifest, name, range, coreId }] : [];
    }),
  )[0];
  assert(mismatch, 'no required core peer available for the incompatible selection');
  cases.push({
    id: `${mismatch.id}:incompatible-core:${mismatch.coreId}`,
    packageId: mismatch.id,
    kind: 'incompatible-core',
    selection: {
      ...selectedInputs(root, manifests, mismatch.id),
      [mismatch.name]: nextVersion(manifests[mismatch.coreId].version),
    },
    constraint: { owner: mismatch.manifest.name, dependency: mismatch.name, range: mismatch.range },
  });
  return cases;
}

export function compatibilityManifestProblems(root, manifests) {
  const problems = [];
  const baseline = manifestsAt(root);
  const coreVersion =
    baseline[Object.keys(RELEASE_PACKAGE_POLICY).find(id => RELEASE_PACKAGE_POLICY[id].group === 'core')].version;
  for (const [id, policy] of Object.entries(RELEASE_PACKAGE_POLICY)) {
    const manifest = manifests[id];
    if (!manifest) {
      problems.push(`${id}: missing manifest`);
      continue;
    }
    if (manifest.name !== baseline[id].name) problems.push(`${id}: package identity differs`);
    if (policy.group === 'core' && manifest.version !== coreVersion)
      problems.push(`${id}: core version must be ${coreVersion}`);
    for (const [dependency, peer] of Object.entries(policy.peers))
      if (
        manifest.peerDependencies?.[dependency] !== peer.range ||
        !satisfiesRange(peer.floor, manifest.peerDependencies?.[dependency] ?? '')
      )
        problems.push(`${id}: ${dependency} must declare ${peer.range}, floor ${peer.floor}`);
  }
  return problems;
}

export function assertCompatibilityReport(plan, report) {
  assert(report && typeof report === 'object', 'missing compatibility report');
  assert(
    report.runtime && report.packageManager && /^[a-f\d]{40}$/.test(report.base),
    'missing runtime/npm/base evidence',
  );
  assert(Array.isArray(report.archives) && report.archives.length > 0, 'missing archive evidence');
  for (const archive of report.archives)
    assert(
      archive.file && /^[a-f\d]{64}$/.test(archive.sha256) && archive.integrity?.startsWith('sha512-'),
      'incomplete archive identity',
    );
  assert.equal(report.cleaned, true, 'campaign resources not cleaned');
  assert.equal(report.registryClosed, true, 'registry not closed');
  assert.equal(report.cases?.length, plan.length, 'missing or unexpected cases');
  const actual = new Map(report.cases.map(item => [item.caseId, item]));
  assert.equal(actual.size, plan.length, 'duplicate cases');
  for (const expected of plan) {
    const receipt = actual.get(expected.id);
    assert(receipt, `missing case ${expected.id}`);
    assert.equal(receipt.packageId, expected.packageId);
    assert.equal(receipt.kind, expected.kind);
    assert.equal(receipt.passed, true, `${expected.id}: failed`);
    assert.equal(receipt.cleaned, true, `${expected.id}: unclean`);
    assert(receipt.evidence, `${expected.id}: missing execution evidence`);
    assert.deepEqual(
      Object.keys(receipt.selection ?? {}).toSorted(),
      Object.keys(expected.selection).toSorted(),
      `${expected.id}: unexpected selected dependency`,
    );
    for (const [name, version] of Object.entries(expected.selection)) {
      const selected = receipt.selection?.[name];
      assert(
        selected === version ||
          (expected.kind === 'below-floor' &&
            name === expected.constraint.dependency &&
            satisfiesRange(selected, version)),
        `${expected.id}: changed selection ${name}`,
      );
    }
    if (expected.kind === 'below-floor' || expected.kind === 'incompatible-core') {
      const install = receipt.commands.filter(item => item.stage === 'install');
      assert.equal(install.length, 1, `${expected.id}: install receipt missing or duplicated`);
      assert(
        Number.isInteger(install[0].exitCode) && install[0].exitCode !== 0,
        `${expected.id}: incompatible installation succeeded`,
      );
      const refusal = receipt.expectedRefusal;
      assert(refusal, `${expected.id}: no attributed refusal`);
      for (const key of ['owner', 'dependency', 'range']) assert.equal(refusal[key], expected.constraint[key]);
      assert(/\bERESOLVE\b/.test(refusal.diagnostic), `${expected.id}: failure was not a dependency refusal`);
      for (const value of Object.values(expected.constraint))
        assert(refusal.diagnostic.includes(value), `${expected.id}: failure did not identify ${value}`);
    } else {
      for (const stage of ['install', 'lock-reinstall', 'types', 'runtime', 'resolution']) {
        const commands = receipt.commands.filter(item => item.stage === stage);
        assert.equal(commands.length, 1, `${expected.id}: missing or duplicate ${stage}`);
        assert.equal(commands[0].exitCode, 0, `${expected.id}: ${stage} failed`);
      }
      assert(receipt.installed?.length > 0, `${expected.id}: no installed package evidence`);
    }
  }
}

/** Inspect the actual npm tree; the pack boundary separately verifies archive bytes. */
export async function verifyConsumerInstallation({ directory, archives }) {
  const canonical = await realpath(directory);
  const lock = json(join(directory, 'package-lock.json'));
  assert.equal(lock.lockfileVersion, 3, 'expected npm package-lock v3');
  const records = new Map(archives.map(record => [`${record.manifest.name}@${record.manifest.version}`, record]));
  const installed = [];
  const roots = new Set(
    Object.keys({ ...lock.packages['']?.dependencies, ...lock.packages['']?.devDependencies }).filter(official),
  );
  const allowed = new Set(roots);
  const names = new Map(archives.map(record => [record.manifest.name, record.manifest]));
  const visit = name => {
    const manifest = names.get(name);
    assert(manifest, `undeclared official root ${name}`);
    for (const dependency of Object.keys(required(manifest)))
      if (official(dependency) && !allowed.has(dependency)) {
        allowed.add(dependency);
        visit(dependency);
      }
  };
  [...roots].forEach(visit);
  for (const [path, locked] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/')) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!official(name)) continue;
    assert(allowed.has(name), `undeclared official package ${name}`);
    const location = join(directory, path);
    assert(!(await lstat(location)).isSymbolicLink() && !locked.link, `${name}: workspace link`);
    const target = await realpath(location);
    assert(target.startsWith(`${canonical}${sep}`), `${name}: installed location escaped consumer`);
    const manifest = json(join(location, 'package.json'));
    const record = records.get(`${name}@${manifest.version}`);
    assert(record, `${name}: unapproved installed version ${manifest.version}`);
    assert.equal(manifest.name, name);
    assert.equal(locked.version, manifest.version);
    assert.equal(locked.integrity, record.integrity, `${name}: lock integrity changed`);
    assert(/^https?:\/\//.test(locked.resolved), `${name}: workspace/file archive resolution`);
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'exports'])
      assert.deepEqual(manifest[key], record.manifest[key], `${name}: altered installed ${key}`);
    for (const entry of Object.values(manifest.exports ?? {})) {
      assert(
        typeof entry?.import === 'string' && entry.import.startsWith('./dist/'),
        `${name}: runtime entry is not dist`,
      );
      for (const exported of [entry.import, entry.types]) {
        const exportedPath = await realpath(join(location, exported));
        assert(exportedPath.startsWith(`${target}${sep}dist${sep}`), `${name}: exported file escaped dist`);
      }
    }
    installed.push({ name, version: manifest.version, resolved: locked.resolved, integrity: locked.integrity });
  }
  for (const name of allowed)
    assert(
      installed.some(item => item.name === name),
      `missing declared official package ${name}`,
    );
  return installed;
}

export async function withCompatibilityWorkspace(parent, run) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'consumer-'));
  let cache;
  try {
    cache = await mkdtemp(join(parent, 'cache-'));
    return await run({ directory, cache });
  } finally {
    const paths = [directory, ...(cache ? [cache] : [])];
    await Promise.all(paths.map(path => rm(path, { recursive: true, force: true })));
    for (const path of paths) assert(!existsSync(path), `cleanup failed: ${path}`);
  }
}

async function digest(bytes, algorithm, encoding = 'hex') {
  const value = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  if (encoding === 'base64') {
    return typeof value.toBase64 === 'function' ? value.toBase64() : globalThis.btoa(String.fromCharCode(...value));
  }
  return typeof value.toHex === 'function'
    ? value.toHex()
    : Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceIdentity(directory) {
  const rows = [];
  const visit = async path => {
    for (const entry of (await readdir(path, { withFileTypes: true })).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (['dist', 'node_modules', '.tsbuildinfo'].includes(entry.name) || entry.name.endsWith('.tsbuildinfo'))
        continue;
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile())
        rows.push([relative(directory, absolute), await digest(await readFile(absolute), 'SHA-256')]);
      else assert.fail(`unexpected package input link ${absolute}`);
    }
  };
  await visit(directory);
  return digest(new TextEncoder().encode(JSON.stringify(rows)), 'SHA-256');
}

async function packOne(root, id, destination, version) {
  const directory = join(root, 'packages', id);
  const original = json(join(directory, 'package.json'));
  const manifest = { ...publishManifest(original), ...(version ? { version } : {}) };
  const staging = await mkdtemp(join(destination, `${id}-stage-`));
  try {
    for (const name of manifest.files)
      if (existsSync(join(directory, name))) await cp(join(directory, name), join(staging, name), { recursive: true });
    assert(existsSync(join(staging, 'dist')), `${id}: build output missing`);
    await writeFile(join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    const result = await command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
      cwd: staging,
      expected: 0,
    });
    const packOutput = JSON.parse(result.stdout);
    const packed = Array.isArray(packOutput) ? packOutput[0] : Object.values(packOutput)[0];
    const file = join(destination, packed.filename);
    const bytes = await readFile(file);
    const integrity = `sha512-${await digest(bytes, 'SHA-512', 'base64')}`;
    assert.equal(packed.integrity, integrity, `${id}: npm pack integrity differs`);
    return {
      id,
      manifest,
      file,
      sourceSha256: await sourceIdentity(directory),
      sha256: await digest(bytes, 'SHA-256'),
      integrity,
      shasum: await digest(bytes, 'SHA-1'),
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function createCompatibilityArchives({
  root = ROOT,
  directory,
  packageIds = Object.keys(RELEASE_PACKAGE_POLICY),
}) {
  await mkdir(directory, { recursive: true });
  const manifests = manifestsAt(root);
  const needed = new Set(officialClosure(manifests, packageIds));
  const catalog = await publishCatalog(root);
  const ordered = [];
  const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const name of Object.keys({ ...manifests[id].dependencies, ...manifests[id].devDependencies })) {
      const child = catalog.find(item => item.npmName === name)?.id;
      if (child && needed.has(child)) visit(child);
    }
    ordered.push(id);
  };
  [...needed].forEach(visit);
  const records = [];
  for (const id of ordered) {
    process.stdout.write(`build/pack ${id}\n`);
    await command(process.execPath, [join(root, 'scripts/build-package.mjs')], {
      cwd: join(root, 'packages', id),
      expected: 0,
      timeout: 120_000,
    });
    records.push(await packOne(root, id, directory));
  }
  return records;
}

async function approvedArchives(root, records) {
  const manifests = manifestsAt(root);
  const names = new Set();
  for (const record of records) {
    assert(manifests[record.id] && !names.has(record.manifest.name), 'unknown or duplicate archive');
    names.add(record.manifest.name);
    assert.deepEqual(record.manifest, publishManifest(manifests[record.id]), `${record.id}: stale published manifest`);
    assert.equal(
      record.sourceSha256,
      await sourceIdentity(join(root, 'packages', record.id)),
      `${record.id}: archive source identity is stale`,
    );
    const bytes = await readFile(record.file);
    assert.equal(record.sha256, await digest(bytes, 'SHA-256'), `${record.id}: archive SHA-256 mismatch`);
    assert.equal(
      record.integrity,
      `sha512-${await digest(bytes, 'SHA-512', 'base64')}`,
      `${record.id}: archive integrity mismatch`,
    );
    const actual = await command('tar', ['-xOf', record.file, 'package/package.json'], { expected: 0 });
    assert.deepEqual(JSON.parse(actual.stdout), record.manifest, `${record.id}: tarball manifest differs`);
  }
  return records;
}

async function registryMetadata(name, version) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}${version ? `/${version}` : ''}`,
    {
      signal: AbortSignal.timeout(30_000),
    },
  );
  assert(response.ok, `${name}: registry metadata HTTP ${response.status}`);
  return response.json();
}

async function publishedVersion(name, accepts) {
  const metadata = await registryMetadata(name);
  const candidates = Object.keys(metadata.versions)
    .map(parseSemver)
    .filter(value => value && value.prerelease.length === 0 && accepts(value));
  const selected = candidates.toSorted((left, right) => compareSemver(right, left))[0];
  assert(selected, `${name}: no published version satisfies the selected constraint`);
  return selected.source;
}

const publishedBelowFloor = (name, floor) =>
  publishedVersion(name, version => compareSemver(version, parseSemver(floor)) < 0);

async function typeInputs(root, manifests, packageId, selection) {
  const rootManifest = json(join(root, 'package.json'));
  const tooling = {
    typescript: RELEASE_PACKAGE_POLICY.compiler.peers.typescript.floor,
    '@types/node': rangeFloor(rootManifest.devDependencies['@types/node']).source,
  };
  for (const id of officialClosure(manifests, [packageId, ...CONSUMER_CASES[packageId].roots]))
    for (const [name, value] of Object.entries(manifests[id].devDependencies ?? {}))
      if (name.startsWith('@types/')) {
        const floor = rangeFloor(value);
        assert(floor, `${id}: unversioned type helper ${name}`);
        tooling[name] = floor.source;
      }
  // A development compiler must also satisfy the selected framework's declared peers.
  // Explicit product TypeScript selections remain authoritative and are never replaced.
  const compilerConstraints = [];
  if (selection.typescript === undefined) {
    for (const name of Object.keys(RELEASE_PACKAGE_POLICY[packageId].peers)) {
      const metadata = await registryMetadata(name, selection[name]);
      const range = metadata.peerDependencies?.typescript;
      if (range) compilerConstraints.push({ owner: name, version: selection[name], range });
    }
    if (compilerConstraints.some(item => !satisfiesRange(tooling.typescript, item.range)))
      tooling.typescript = await publishedVersion('typescript', version =>
        compilerConstraints.every(item => satisfiesRange(version, item.range)),
      );
  }
  return { tooling, compilerConstraints };
}

async function runConsumer({ root, item, records, registry, parent, packageManager, base }) {
  const fixture = CONSUMER_CASES[item.packageId];
  const receipt = {
    caseId: item.id,
    packageId: item.packageId,
    kind: item.kind,
    selection: { ...item.selection },
    evidence: fixture.evidence,
    commands: [],
    installed: [],
    runtime: process.version,
    packageManager,
    passed: false,
    cleaned: false,
  };
  const negative = item.kind === 'below-floor' || item.kind === 'incompatible-core';
  if (item.kind === 'below-floor')
    receipt.selection[item.constraint.dependency] = await publishedBelowFloor(
      item.constraint.dependency,
      RELEASE_PACKAGE_POLICY[item.packageId].peers[item.constraint.dependency].floor,
    );
  try {
    await withCompatibilityWorkspace(parent, async ({ directory, cache }) => {
      receipt.directory = directory;
      receipt.cache = cache;
      if (!negative && fixture.service)
        assert(process.env[fixture.service], `${item.id}: required real service ${fixture.service} is missing`);
      const dependencies = { ...receipt.selection };
      const inputs = negative
        ? { tooling: {}, compilerConstraints: [] }
        : await typeInputs(root, manifestsAt(root), item.packageId, receipt.selection);
      const devDependencies = inputs.tooling;
      receipt.compilerConstraints = inputs.compilerConstraints;
      for (const name of Object.keys(dependencies)) delete devDependencies[name];
      receipt.developmentDependencies = { ...devDependencies };
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify(
          { name: 'release-compatibility-consumer', private: true, type: 'module', dependencies, devDependencies },
          null,
          2,
        ) + '\n',
      );
      const env = {
        npm_config_cache: cache,
        npm_config_registry: registry.origin,
        npm_config_fetch_retries: '0',
        NODE_TEST_CONTEXT: undefined,
        ZMDB_REQUIRE_PG: '1',
      };
      const invoke = async (stage, executable, argv) => {
        const result = await command(executable, argv, { cwd: directory, env, timeout: 180_000 });
        receipt.commands.push({ stage, exitCode: result.code, stdout: result.stdout, stderr: result.stderr });
        if (stage !== 'install' || !negative)
          assert.equal(result.code, 0, `${item.id}: ${stage}\n${result.stdout}\n${result.stderr}`);
        return result;
      };
      const flags = ['--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'];
      const installation = await invoke('install', 'npm', ['install', ...flags]);
      if (negative) {
        assert.notEqual(installation.code, 0, `${item.id}: incompatible install succeeded`);
        receipt.expectedRefusal = {
          ...item.constraint,
          selected: receipt.selection[item.constraint.dependency],
          diagnostic: `${installation.stdout}\n${installation.stderr}`,
        };
        return;
      }
      await invoke('lock-reinstall', 'npm', ['ci', ...flags]);
      for (const [source, destination] of Object.entries(fixture.files)) {
        const target = join(directory, destination);
        await mkdir(dirname(target), { recursive: true });
        await cp(join(root, source), target);
      }
      await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              lib: ['ESNext', 'DOM', 'DOM.Iterable'],
              types: ['node'],
              strict: true,
              exactOptionalPropertyTypes: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: true,
              allowImportingTsExtensions: false,
              allowJs: true,
              checkJs: false,
              rootDir: 'src',
              outDir: 'lib',
            },
            include: ['src/**/*'],
          },
          null,
          2,
        ) + '\n',
      );
      await invoke('types', join(directory, 'node_modules/.bin/tsc'), [
        '--project',
        'tsconfig.json',
        '--pretty',
        'false',
      ]);
      const runtime = await invoke('runtime', process.execPath, [
        ...fixture.conditions.map(value => `--conditions=${value}`),
        fixture.runtime,
      ]);
      assert(!/\[skip\]/i.test(runtime.stdout + runtime.stderr), `${item.id}: runtime skipped`);
      receipt.installed = await verifyConsumerInstallation({ directory, archives: records });
      receipt.commands.push({ stage: 'resolution', exitCode: 0 });
      receipt.lockSha256 = await digest(await readFile(join(directory, 'package-lock.json')), 'SHA-256');
    });
    receipt.cleaned = true;
    receipt.passed = true;
    assertCompatibilityReport([item], {
      runtime: process.version,
      packageManager,
      base,
      archives: records,
      cleaned: true,
      registryClosed: true,
      cases: [receipt],
    });
  } catch (error) {
    receipt.cleaned = ![receipt.directory, receipt.cache].filter(Boolean).some(existsSync);
    receipt.passed = false;
    receipt.error = String(error.stack ?? error);
  }
  return receipt;
}

/** Real npm archives and external installed programs; deliberately outside the ordinary Vitest run. */
export async function qualifyReleaseCompatibility({ root = ROOT, archives, packageId, evidence } = {}) {
  const manifests = manifestsAt(root);
  assert.deepEqual(compatibilityManifestProblems(root, manifests), [], 'release manifests drifted');
  const plan = releaseCompatibilityPlan(root).filter(item => packageId === undefined || item.packageId === packageId);
  assert(plan.length > 0, `no release cases for ${packageId}`);
  const capture = promisify(execFile);
  const environment = cleanEnvironment();
  const base = (
    await capture('git', ['rev-parse', 'HEAD'], { cwd: root, env: environment, timeout: 30_000 })
  ).stdout.trim();
  const packageManager = `npm ${(await capture('npm', ['--version'], { cwd: dirname(root), env: environment, timeout: 30_000 })).stdout.trim()}`;
  const parent = await mkdtemp(join(dirname(root), 'release-compatibility-'));
  const report = {
    base,
    runtime: process.version,
    packageManager,
    scope: packageId ?? 'all-current-policy-units',
    archives: [],
    cases: [],
    cleaned: false,
    registryClosed: false,
  };
  let registry;
  try {
    const ids = [...new Set(plan.flatMap(item => [item.packageId, ...CONSUMER_CASES[item.packageId].roots]))];
    await mkdir(join(parent, 'archives'), { recursive: true });
    const records = archives
      ? await approvedArchives(root, archives)
      : await createCompatibilityArchives({ root, directory: join(parent, 'archives'), packageIds: ids });
    report.archives = [...records];
    const map = new Map(records.map(record => [record.manifest.name, record]));
    registry = await startRegistry(map);
    report.registry = registry.origin;
    for (const item of plan) {
      process.stdout.write(`${item.id}\n`);
      let selectedRecords = records;
      let selectedRegistry = registry;
      let variant;
      try {
        if (item.kind === 'independent-integration' || item.kind === 'incompatible-core') {
          const name =
            item.kind === 'independent-integration' ? manifests[item.packageId].name : item.constraint.dependency;
          const id = Object.keys(manifests).find(key => manifests[key].name === name);
          const record = await packOne(root, id, join(parent, 'archives'), item.selection[name]);
          report.archives.push(record);
          selectedRecords = records.filter(entry => entry.manifest.name !== name).concat(record);
          variant = await startRegistry(new Map(selectedRecords.map(entry => [entry.manifest.name, entry])));
          selectedRegistry = variant;
        }
        report.cases.push(
          await runConsumer({
            root,
            item,
            records: selectedRecords,
            registry: selectedRegistry,
            parent,
            packageManager,
            base,
          }),
        );
      } finally {
        if (variant) await variant.close();
      }
      if (evidence) await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
    }
  } catch (error) {
    report.error = String(error.stack ?? error);
  } finally {
    try {
      if (registry) await registry.close();
      report.registryClosed = true;
    } finally {
      await rm(parent, { recursive: true, force: true });
      report.cleaned = !existsSync(parent);
    }
    if (evidence) await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
  }
  assert(!report.error, report.error);
  assertCompatibilityReport(plan, report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: { evidence: { type: 'string' }, archives: { type: 'string' }, package: { type: 'string' } },
  });
  try {
    if (values.evidence) await mkdir(dirname(resolve(values.evidence)), { recursive: true });
    const supplied = values.archives ? json(resolve(values.archives)) : undefined;
    const result = await qualifyReleaseCompatibility({
      evidence: values.evidence && resolve(values.evidence),
      archives: supplied?.archives ?? supplied,
      packageId: values.package,
    });
    process.stdout.write(
      `release compatibility: ${result.cases.length} cases passed; consumers, caches and registries cleaned\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
