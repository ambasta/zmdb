import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOTS = Object.freeze({
  default: Object.freeze(['zmdb']),
  sqlite: Object.freeze(['zmdb', '@zmdb/app', '@zmdb/jobs', '@zmdb/jobs-sqlite']),
  postgres: Object.freeze(['@zmdb/app', '@zmdb/jobs', '@zmdb/jobs-postgres', 'pg']),
});

export async function inspectInstalledConsumer(directory, lane, approvedIntegrities) {
  assert(Object.hasOwn(ROOTS, lane), `unknown selected-jobs lane ${lane}`);
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(
    Object.keys(manifest.dependencies).toSorted(),
    [...ROOTS[lane]].toSorted(),
    'consumer direct dependencies',
  );
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const packages = [];
  async function inspect(path) {
    const resolved = await realpath(path);
    const location = relative(root, resolved);
    assert(location !== '..' && !location.startsWith(`..${sep}`), `installed package escapes consumer: ${path}`);
    const data = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    const lockPath = relative(root, path).split(sep).join('/');
    const locked = lock.packages[lockPath];
    assert(locked && locked.version === data.version, `unlocked installed package ${data.name}`);
    if (data.name === 'zmdb' || data.name.startsWith('@zmdb/')) {
      assert(approvedIntegrities.has(data.name), `undeclared tarball ${data.name}`);
      assert.equal(locked.integrity, approvedIntegrities.get(data.name), `wrong tarball integrity ${data.name}`);
    }
    packages.push({
      name: data.name,
      version: data.version,
      path: lockPath,
      dev: locked.dev === true,
      dependencies: data.dependencies ?? {},
      peerDependencies: data.peerDependencies ?? {},
      peerDependenciesMeta: data.peerDependenciesMeta ?? {},
    });
    await visit(join(path, 'node_modules'));
  }
  async function visit(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        for (const scoped of await readdir(join(path, entry.name))) await inspect(join(path, entry.name, scoped));
      } else await inspect(join(path, entry.name));
    }
  }
  await visit(join(root, 'node_modules'));
  const names = new Set(packages.map(entry => entry.name));
  const jobs = [...names].filter(name => name === '@zmdb/jobs' || name.startsWith('@zmdb/jobs-')).toSorted();
  assert.deepEqual(jobs, lane === 'default' ? [] : ['@zmdb/jobs', `@zmdb/jobs-${lane}`], 'selected provider closure');
  if (lane !== 'default') {
    const provider = packages.find(entry => entry.name === `@zmdb/jobs-${lane}`);
    const portable = packages.find(entry => entry.name === '@zmdb/jobs');
    assert.equal(
      provider.peerDependencies['@zmdb/jobs'],
      portable.version,
      'provider requires the installed portable jobs version',
    );
    assert.notEqual(
      provider.peerDependenciesMeta['@zmdb/jobs']?.optional,
      true,
      'provider requires an explicit jobs peer',
    );
    assert.equal(provider.dependencies['@zmdb/jobs'], undefined, 'provider must not bundle a second jobs runtime');
  }
  const forbidden =
    lane === 'default'
      ? ['@zmdb/jobs', '@zmdb/jobs-sqlite', '@zmdb/jobs-postgres']
      : [`@zmdb/jobs-${lane === 'sqlite' ? 'postgres' : 'sqlite'}`];
  const resolutions = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const names=${JSON.stringify([...ROOTS[lane], ...forbidden])};
console.log(JSON.stringify(Object.fromEntries(names.map(name => {
  try { return [name, { url: import.meta.resolve(name) }]; }
  catch (error) { return [name, { code: error.code }]; }
}))));`,
      ],
      { cwd: root, encoding: 'utf8', timeout: 10_000, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } },
    ),
  );
  for (const name of ROOTS[lane]) {
    assert.equal(typeof resolutions[name].url, 'string', `${name} public ESM root does not resolve`);
    const resolved = await realpath(fileURLToPath(resolutions[name].url));
    assert(resolved.startsWith(`${root}${sep}`), `${name} root resolves outside consumer`);
    if (name === 'zmdb' || name.startsWith('@zmdb/')) {
      assert(resolved.includes(`${sep}dist${sep}`) && !resolved.endsWith('.ts'), `${name} resolves workspace source`);
    }
  }
  for (const name of forbidden) {
    assert.equal(resolutions[name].code, 'ERR_MODULE_NOT_FOUND', `${name} remains available`);
  }
  return {
    lane,
    directDependencies: [...ROOTS[lane]],
    packages: packages.toSorted((left, right) => left.path.localeCompare(right.path)),
  };
}
