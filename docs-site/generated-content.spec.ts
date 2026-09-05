import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PRODUCT_JOURNEY } from './navigation-plan.mjs';

const ROOT = process.cwd();
const PACKAGE_REFERENCE = 'docs-site/content/package-reference.md';
const FRAMEWORK_INTEGRATIONS = 'docs-site/content/framework-integrations.md';
const PACKAGE_MARKER = 'product-catalog package-reference';
const INTEGRATION_MARKER = 'integrations framework-integrations';
const FRAMEWORKS = ['React', 'Angular', 'Vue', 'Svelte', 'Solid', 'React Native', 'Next.js', 'Nuxt', 'SvelteKit'];
const TEST_TIMEOUT = 90_000;

interface CommandResult {
  readonly status: number | null;
  readonly output: string;
}

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
}

interface IntegrationRecord {
  readonly capability: string;
  readonly package: string | null;
  readonly status: 'built-in' | 'optional' | 'documented' | 'not-planned';
  readonly peer?: string;
  readonly docs: string;
  readonly evidence: readonly string[];
}

function createFixture(): string {
  const fixture = mkdtempSync(join(tmpdir(), 'zmdb-docs-generated-'));
  cpSync(join(ROOT, 'docs-site'), join(fixture, 'docs-site'), { recursive: true });

  for (const directory of ['.github', 'benchmarks', 'fixtures', 'packages', 'scripts', 'node_modules']) {
    symlinkSync(join(ROOT, directory), join(fixture, directory), 'dir');
  }
  for (const file of ['package.json', 'yarn.lock', 'tsconfig.json', '.yarnrc.yml']) {
    symlinkSync(join(ROOT, file), join(fixture, file), 'file');
  }
  return fixture;
}

function withFixture<T>(use: (fixture: string) => T): T {
  const fixture = createFixture();
  try {
    return use(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function run(fixture: string, command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: TEST_TIMEOUT,
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function build(fixture: string): CommandResult {
  return run(fixture, process.execPath, ['--import=./scripts/ts-specifier-hook.mjs', 'docs-site/build.mjs']);
}

function verifyGenerated(fixture: string): CommandResult {
  return run(fixture, 'yarn', ['verify:docs-generated']);
}

function markerDocument(marker: string): string {
  return [
    '# Fixture',
    '',
    'Authored prose before the generated section.',
    '',
    `<!-- generated: ${marker} -->`,
    'STALE GENERATED SENTINEL',
    `<!-- /generated: ${marker} -->`,
    '',
    'Authored prose after the generated section.',
    '',
  ].join('\n');
}

function generatedSection(source: string, marker: string): string {
  const open = `<!-- generated: ${marker} -->`;
  const close = `<!-- /generated: ${marker} -->`;
  const openAt = source.indexOf(open);
  const closeAt = source.indexOf(close);
  if (openAt < 0 || closeAt < 0 || closeAt < openAt) {
    throw new Error(`missing or reversed generated marker pair: ${marker}`);
  }
  if (source.indexOf(open, openAt + open.length) >= 0 || source.indexOf(close, closeAt + close.length) >= 0) {
    throw new Error(`duplicated generated marker pair: ${marker}`);
  }
  return source.slice(openAt + open.length, closeAt);
}

function publicPackageManifests(root: string): PackageManifest[] {
  const packages = join(root, 'packages');
  return readdirSync(packages, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(packages, entry.name, 'package.json')))
    .map(entry => JSON.parse(readFileSync(join(packages, entry.name, 'package.json'), 'utf8')) as PackageManifest)
    .filter(manifest => manifest.name === 'zmdb' || manifest.name.startsWith('@zmdb/'))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function integrationRecords(value: object): readonly IntegrationRecord[] | undefined {
  for (const candidate of Object.values(value)) {
    if (
      Array.isArray(candidate) &&
      candidate.every(
        item =>
          typeof item === 'object' &&
          item !== null &&
          typeof Reflect.get(item, 'capability') === 'string' &&
          typeof Reflect.get(item, 'status') === 'string',
      )
    ) {
      return candidate as readonly IntegrationRecord[];
    }
  }
  return undefined;
}

function materializePackageManifests(fixture: string): void {
  rmSync(join(fixture, 'packages'), { recursive: true, force: true });
  mkdirSync(join(fixture, 'packages'), { recursive: true });
  for (const entry of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    const manifest = join(ROOT, 'packages', entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    mkdirSync(join(fixture, 'packages', entry.name), { recursive: true });
    cpSync(manifest, join(fixture, 'packages', entry.name, 'package.json'));
  }
}

describe('generated documentation truth', { timeout: TEST_TIMEOUT }, () => {
  it('generates package names, versions, exports, peers and engines from manifests', () => {
    withFixture(fixture => {
      const target = join(fixture, PACKAGE_REFERENCE);
      writeFileSync(target, markerDocument(PACKAGE_MARKER));

      const result = build(fixture);
      expect(result.status, result.output).toBe(0);

      const source = readFileSync(target, 'utf8');
      expect(source).toContain('Authored prose before the generated section.');
      expect(source).toContain('Authored prose after the generated section.');
      const generated = generatedSection(source, PACKAGE_MARKER);
      expect(generated).not.toContain('STALE GENERATED SENTINEL');

      const manifests = publicPackageManifests(ROOT);
      expect(manifests.length).toBeGreaterThan(0);
      for (const manifest of manifests) {
        expect(generated, manifest.name).toContain(manifest.name);
        expect(generated, manifest.name).toContain(manifest.version);
        if (manifest.description !== undefined) expect(generated, manifest.name).toContain(manifest.description);
        for (const name of Object.keys(manifest.exports ?? {}))
          expect(generated, `${manifest.name}:${name}`).toContain(name);
        for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
          expect(generated, `${manifest.name}:${name}`).toContain(name);
          expect(generated, `${manifest.name}:${name}`).toContain(range);
        }
        for (const [name, range] of Object.entries(manifest.engines ?? {})) {
          expect(generated, `${manifest.name}:${name}`).toContain(name);
          expect(generated, `${manifest.name}:${name}`).toContain(range);
        }
      }

      const positions = manifests.map(manifest => generated.indexOf(`| ${manifest.name}`));
      expect(positions.every(position => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].toSorted((left, right) => left - right));
      expect(generated).toMatch(/\bnpm (?:install|add)\b/);
    });
  });

  it('generates every integration row from evidence-bearing data', () => {
    withFixture(fixture => {
      const target = join(fixture, FRAMEWORK_INTEGRATIONS);
      writeFileSync(target, markerDocument(INTEGRATION_MARKER));

      const result = build(fixture);
      expect(result.status, result.output).toBe(0);

      const generated = generatedSection(readFileSync(target, 'utf8'), INTEGRATION_MARKER);
      expect(generated).not.toContain('STALE GENERATED SENTINEL');
      for (const framework of FRAMEWORKS) expect(generated, framework).toContain(framework);
      expect(generated).toMatch(/\b(built-in|optional|documented|not-planned)\b/);
      expect(generated).toMatch(/(?:packages|docs-site)\//);
    });
  });

  it('leaves generated content byte-identical on a second run', () => {
    withFixture(fixture => {
      const packageReference = join(fixture, PACKAGE_REFERENCE);
      const integrations = join(fixture, FRAMEWORK_INTEGRATIONS);
      writeFileSync(packageReference, markerDocument(PACKAGE_MARKER));
      writeFileSync(integrations, markerDocument(INTEGRATION_MARKER));
      const before = `${readFileSync(packageReference, 'utf8')}\n${readFileSync(integrations, 'utf8')}`;

      const firstResult = build(fixture);
      expect(firstResult.status, firstResult.output).toBe(0);
      const first = `${readFileSync(packageReference, 'utf8')}\n${readFileSync(integrations, 'utf8')}`;

      const secondResult = build(fixture);
      expect(secondResult.status, secondResult.output).toBe(0);
      const second = `${readFileSync(packageReference, 'utf8')}\n${readFileSync(integrations, 'utf8')}`;

      expect(first).not.toBe(before);
      expect(second).toBe(first);
      expect(first).not.toContain('STALE GENERATED SENTINEL');
      expect(readFileSync(packageReference, 'utf8')).toMatch(/\n$/);
      expect(readFileSync(integrations, 'utf8')).toMatch(/\n$/);
    });
  });

  it('rejects missing, duplicated, nested and reversed generated markers', () => {
    const cases = [
      ['missing close', `<!-- generated: ${INTEGRATION_MARKER} -->\nstale\n`],
      ['duplicated pair', `${markerDocument(INTEGRATION_MARKER)}\n${markerDocument(INTEGRATION_MARKER)}`],
      [
        'nested pair',
        [
          `<!-- generated: ${INTEGRATION_MARKER} -->`,
          `<!-- generated: ${INTEGRATION_MARKER} -->`,
          `<!-- /generated: ${INTEGRATION_MARKER} -->`,
          `<!-- /generated: ${INTEGRATION_MARKER} -->`,
          '',
        ].join('\n'),
      ],
      [
        'reversed pair',
        [`<!-- /generated: ${INTEGRATION_MARKER} -->`, `<!-- generated: ${INTEGRATION_MARKER} -->`, ''].join('\n'),
      ],
    ] as const;
    const problems: string[] = [];

    for (const [label, source] of cases) {
      withFixture(fixture => {
        writeFileSync(join(fixture, FRAMEWORK_INTEGRATIONS), source);
        const result = verifyGenerated(fixture);
        if (
          result.status === 0 ||
          !/framework-integrations\.md/i.test(result.output) ||
          !/marker/i.test(result.output)
        ) {
          problems.push(`${label}: ${result.output.trim()}`);
        }
      });
    }

    expect(problems).toEqual([]);
  });

  it('checks generated content without modifying the working tree', () => {
    withFixture(fixture => {
      const packageReference = join(fixture, PACKAGE_REFERENCE);
      const integrations = join(fixture, FRAMEWORK_INTEGRATIONS);
      writeFileSync(packageReference, markerDocument(PACKAGE_MARKER));
      writeFileSync(integrations, markerDocument(INTEGRATION_MARKER));
      expect(build(fixture).status).toBe(0);

      const before = `${readFileSync(packageReference, 'utf8')}\n${readFileSync(integrations, 'utf8')}`;
      const result = verifyGenerated(fixture);
      const after = `${readFileSync(packageReference, 'utf8')}\n${readFileSync(integrations, 'utf8')}`;

      expect(result.status, result.output).toBe(0);
      expect(after).toBe(before);
    });
  });

  it('rejects stale, unregistered and manifest-mismatched catalog ownership', () => {
    const cases = [
      {
        label: 'stale row',
        mutate(fixture: string) {
          rmSync(join(fixture, 'packages', 'zmdb'), { recursive: true, force: true });
        },
        evidence: /zmdb/i,
      },
      {
        label: 'unregistered package',
        mutate(fixture: string) {
          const directory = join(fixture, 'packages', 'unregistered');
          mkdirSync(directory, { recursive: true });
          writeFileSync(
            join(directory, 'package.json'),
            `${JSON.stringify({ name: '@zmdb/unregistered', version: '0.0.0', exports: { '.': './index.js' } }, null, 2)}\n`,
          );
        },
        evidence: /@zmdb\/unregistered/i,
      },
      {
        label: 'name mismatch',
        mutate(fixture: string) {
          const target = join(fixture, 'packages', 'zmdb', 'package.json');
          const manifest = JSON.parse(readFileSync(target, 'utf8')) as PackageManifest;
          writeFileSync(target, `${JSON.stringify({ ...manifest, name: 'zmdb-mismatch' }, null, 2)}\n`);
        },
        evidence: /zmdb-mismatch|name mismatch/i,
      },
    ];
    const problems: string[] = [];

    for (const one of cases) {
      withFixture(fixture => {
        materializePackageManifests(fixture);
        one.mutate(fixture);
        const result = verifyGenerated(fixture);
        if (
          result.status === 0 ||
          !/catalog|manifest|package/i.test(result.output) ||
          !one.evidence.test(result.output)
        ) {
          problems.push(`${one.label}: ${result.output.trim()}`);
        }
      });
    }

    expect(problems).toEqual([]);
  });

  it('validates integration status, package, peer, docs and evidence ownership', async () => {
    const modulePath = join(ROOT, 'docs-site', 'integrations.mjs');
    const module = (await import(`${pathToFileURL(modulePath).href}?freeze=714`)) as object;
    const records = integrationRecords(module);
    expect(records).toBeDefined();

    const canonicalSlugs = new Set(PRODUCT_JOURNEY.flatMap(group => group.pages));
    const manifests = new Map(publicPackageManifests(ROOT).map(manifest => [manifest.name, manifest]));
    for (const framework of FRAMEWORKS) {
      expect(records?.filter(record => record.capability === framework)).toHaveLength(1);
    }

    for (const record of records ?? []) {
      expect(['built-in', 'optional', 'documented', 'not-planned']).toContain(record.status);
      expect(canonicalSlugs.has(record.docs), `${record.capability}:${record.docs}`).toBe(true);
      expect(record.evidence.length, record.capability).toBeGreaterThan(0);
      for (const path of record.evidence)
        expect(existsSync(join(ROOT, path)), `${record.capability}:${path}`).toBe(true);

      if (record.status === 'not-planned') {
        expect(record.package, record.capability).toBeNull();
        expect(record.peer, record.capability).toBeUndefined();
        continue;
      }

      expect(record.package, record.capability).not.toBeNull();
      expect(manifests.has(record.package ?? ''), record.capability).toBe(true);
      if (record.status === 'optional') {
        expect(record.peer, record.capability).toBeDefined();
        expect(
          manifests.get(record.package ?? '')?.peerDependencies?.[record.peer ?? ''],
          record.capability,
        ).toBeDefined();
      } else {
        expect(record.peer, record.capability).toBeUndefined();
      }
    }
  });
});
