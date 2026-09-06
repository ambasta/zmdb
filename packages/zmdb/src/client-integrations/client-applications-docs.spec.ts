import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  publishCatalog,
  ROOT,
  publishManifest,
  readManifest,
} from '../../../../.github/scripts/lib/publish-manifest.mjs';
import {
  CLIENT_APPLICATIONS,
  CLIENT_GUIDE_SECTIONS,
  RECIPE_ONLY_CLIENTS,
} from '../../../../docs-site/client-applications.mjs';
import { ADAPTER_PACKAGES } from '../../../../fixtures/client-adapters/src/index.js';
import type { AdapterPackageExpectation, PackedProjectResult } from '../../../../fixtures/client-adapters/src/index.js';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
} from '../../../../fixtures/client-adapters/src/packed-project.js';

const PUBLISH_PACKAGES = await publishCatalog(ROOT);
const PRODUCT_CATALOG = PUBLISH_PACKAGES.map(packageRecord => packageRecord.catalog);
const OVERVIEW = source('docs-site/content/framework-integrations.md');

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function page(slug: string): string {
  return source(`docs-site/content/${slug}.md`);
}

function documentedExample(slug: string, fixture: string): string {
  const marker = `// docs-file: ${fixture}\n`;
  const opening = `\`\`\`ts\n${marker}`;
  const contents = page(slug);
  const start = contents.indexOf(opening);
  if (start === -1) throw new Error(`${slug} has no canonical example for ${fixture}`);
  const body = start + opening.length;
  const end = contents.indexOf('\n```', body);
  if (end === -1) throw new Error(`${slug} has an unterminated canonical example`);
  return `${contents.slice(body, end)}\n`;
}

function normalizedSource(contents: string): string {
  return contents
    .replaceAll(/,\s*([)\]}])/g, '$1')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function build(packageName: string): void {
  const result = spawnSync('yarn', ['workspace', packageName, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${packageName} build failed with ${String(result.status)}\n${result.stdout}\n${result.stderr}`);
  }
}

function packedFiles(): Readonly<Record<string, string>> {
  return {
    '.npmrc': [
      '# SvelteKit 2.70.3 still caps its optional TypeScript peer at 6.x.',
      '# The compiler command below proves the fixture still runs exact 7.0.2.',
      'legacy-peer-deps=true',
      '',
    ].join('\n'),
    'src/api.generated.ts': source('fixtures/client-adapters/src/generated/api.generated.ts'),
    ...Object.fromEntries(
      CLIENT_APPLICATIONS.map(application => [
        `src/${application.slug}.ts`,
        documentedExample(application.slug, application.example),
      ]),
    ),
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: false,
          lib: ['ES2024', 'DOM', 'DOM.Iterable'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2024',
          types: ['node'],
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  };
}

function expectedSupport(expectation: AdapterPackageExpectation) {
  const native = expectation.qualification.kind === 'native';
  return {
    csr: native ? 'native' : 'yes',
    ssr: expectation.qualification.ssr ? 'yes' : 'no',
    hydration: expectation.qualification.kind === 'meta-framework' ? 'yes' : native ? 'n/a' : 'framework-owned',
    cancellation: 'yes',
    nativeLifecycle: native ? 'yes' : 'no',
  };
}

describe('Client Applications documentation (#701)', () => {
  let packed: PackedProjectResult | undefined;

  afterEach(() => {
    packed?.cleanup();
    packed = undefined;
  });

  it(
    'every framework example compiles in its packed fixture',
    () => {
      packed = runPackedProject({
        name: '@zmdb-fixture/client-applications-docs',
        buildLockRoot: ROOT,
        preparePackages() {
          build('@zmdb/client');
          for (const application of CLIENT_APPLICATIONS) build(application.package);
        },
        packages: [
          {
            directory: join(ROOT, 'packages/client'),
            manifest: publishManifest(readManifest('client', PUBLISH_PACKAGES)),
          },
          ...ADAPTER_PACKAGES.map(expectation => ({
            directory: join(ROOT, 'packages', expectation.directory),
            manifest: publishManifest(readManifest(expectation.directory, PUBLISH_PACKAGES)),
          })),
        ],
        dependencies: {
          '@angular/core': '22.1.5',
          '@sveltejs/kit': '2.70.3',
          next: '16.3.4',
          nuxt: '4.5.2',
          react: '19.2.8',
          'react-dom': '19.2.8',
          'react-native': '0.87.1',
          rxjs: '7.8.2',
          'solid-js': '1.9.15',
          svelte: '5.57.0',
          vue: '3.5.42',
        },
        devDependencies: {
          '@types/node': '26.4.1',
          '@types/react': '19.2.18',
          '@types/react-dom': '19.2.7',
          typescript: '7.0.2',
        },
        files: packedFiles(),
        commands: [
          {
            label: 'packed TypeScript 7.0.2',
            command: process.execPath,
            arguments: [
              '--input-type=module',
              '--eval',
              "const { version } = await import('typescript'); if (version !== '7.0.2') throw new Error(`expected TypeScript 7.0.2, received ${version}`);",
            ],
          },
          {
            label: 'packed Client Applications examples',
            command: process.execPath,
            arguments: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
          },
        ],
      });

      expect([...packed.tarballs.keys()].toSorted()).toEqual([
        '@zmdb/angular',
        '@zmdb/client',
        '@zmdb/next',
        '@zmdb/nuxt',
        '@zmdb/react',
        '@zmdb/react-native',
        '@zmdb/solid',
        '@zmdb/svelte',
        '@zmdb/sveltekit',
        '@zmdb/vue',
      ]);
      expect(packed.commands.map(command => [command.label, command.status])).toEqual([
        ['packed TypeScript 7.0.2', 0],
        ['packed Client Applications examples', 0],
      ]);
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it('the support matrix matches package conformance metadata', () => {
    expect(CLIENT_APPLICATIONS).toHaveLength(9);
    expect(
      CLIENT_APPLICATIONS.map(application => ({
        package: application.package,
        kind: application.kind,
        support: application.support,
        packedTest: application.packedTest,
      })),
    ).toEqual(
      ADAPTER_PACKAGES.map(expectation => ({
        package: expectation.name,
        kind: expectation.qualification.kind,
        support: expectedSupport(expectation),
        packedTest: expectation.qualification.packedTest,
      })),
    );

    for (const application of CLIENT_APPLICATIONS) {
      const product = PRODUCT_CATALOG.find(row => row.npmName === application.package);
      expect(product?.docsOwner, application.package).toBe(application.slug);
      expect(OVERVIEW, application.name).toContain(
        `| ${application.name.padEnd(12)} | ${application.support.csr.padEnd(6)} |`,
      );
      expect(OVERVIEW, application.package).toContain(`[${application.slug}](./${application.slug}.html)`);
    }
  });

  it('no adapter page duplicates URL authentication or validation implementation', () => {
    for (const application of CLIENT_APPLICATIONS) {
      const contents = page(application.slug);
      expect(contents, application.slug).toMatch(/own\s+URL\s+construction/);
      expect(contents, application.slug).toMatch(/authentication\s+(?:patches|patching)/);
      expect(contents, application.slug).toMatch(/response\s+validation/);
      expect(contents, application.slug).not.toMatch(/\bfetch\s*\(/);
      expect(contents, application.slug).not.toMatch(/\bnew URL\s*\(/);
      expect(contents, application.slug).not.toMatch(/\bdecode[A-Z]\w*\s*\(/);
      expect(contents, application.slug).not.toMatch(/authorization:\s*['"]/i);
    }
  });

  it('recipe-only integrations are not documented as packages', () => {
    const npmNames = new Set(PRODUCT_CATALOG.map(product => product.npmName));
    for (const recipe of RECIPE_ONLY_CLIENTS) {
      const packageName = `@zmdb/${recipe.toLowerCase().replaceAll(' ', '-')}`;
      expect(OVERVIEW).toContain(recipe);
      expect(OVERVIEW).toContain(`\`${packageName}\``);
      expect(npmNames.has(packageName), packageName).toBe(false);
    }
  });

  it('all nine guides share the same structure and exact executable example', () => {
    for (const application of CLIENT_APPLICATIONS) {
      expect(
        [...page(application.slug).matchAll(/^## (.+)$/gm)].map(match => match[1]),
        application.slug,
      ).toEqual(CLIENT_GUIDE_SECTIONS);
      expect(normalizedSource(documentedExample(application.slug, application.example)), application.slug).toBe(
        normalizedSource(source(application.example)),
      );
    }
  });

  it('existing entry pages route readers through one generated client', () => {
    const links = new Map([
      ['aot-setup', './client-react-native.html'],
      ['connect-react-native', './client-react-native.html'],
      ['deploy-nextjs', './client-next.html'],
      ['generated-client', './framework-integrations.html'],
      ['installation', './framework-integrations.html'],
      ['openapi', './generated-client.html'],
      ['tutorials', './framework-integrations.html'],
    ]);
    for (const [slug, link] of links) expect(page(slug), slug).toContain(link);
  });
});
