import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PAGE_META } from './pages.mjs';

const ROOT = process.cwd();
const TEST_TIMEOUT = 90_000;

const INTEGRATIONS = [
  {
    packageName: '@zmdb/protobuf',
    directory: 'protobuf',
    peer: undefined,
    ownership: ['build-time reflector/emitter', 'owns no compiler process'],
  },
  {
    packageName: '@zmdb/transport-grpc',
    directory: 'transport-grpc',
    peer: ['@grpc/grpc-js', '^1.14.4'],
    ownership: ['application owns the server extension', 'caller owns every client'],
  },
  {
    packageName: '@zmdb/transport-nats',
    directory: 'transport-nats',
    peer: ['@nats-io/transport-node', '^3.4.0'],
    ownership: ['transportExtension', 'closes it'],
  },
  {
    packageName: '@zmdb/transport-rabbitmq',
    directory: 'transport-rabbitmq',
    peer: ['amqplib', '^2.0.1'],
    ownership: ['application lifecycle starts it', 'channels and connection'],
  },
  {
    packageName: '@zmdb/transport-redis',
    directory: 'transport-redis',
    peer: ['redis', '^6.2.1'],
    ownership: ['owns startup and bounded shutdown', 'publisher and subscriber clients'],
  },
  {
    packageName: '@zmdb/jobs-postgres',
    directory: 'jobs-postgres',
    peer: ['pg', '^8.23.0'],
    ownership: ['caller retains ownership', 'never calls `end()` or `release()`'],
  },
  {
    packageName: '@zmdb/otel',
    directory: 'otel',
    peer: ['@opentelemetry/api', '^1.9.1'],
    ownership: ['caller-owned OpenTelemetry', 'shutdown hook'],
  },
] as const;

const REMOVED_SUBPATHS = [
  '@zmdb/aot-validator/protobuf/wire',
  '@zmdb/web/microservices/grpc',
  '@zmdb/web/microservices/nats',
  '@zmdb/web/microservices/rabbitmq',
  '@zmdb/web/microservices/redis',
  '@zmdb/web/queues/backends/pg',
  '@zmdb/web/queues/backends/memory',
  '@zmdb/web/queues',
  '@zmdb/web/otel',
] as const;

const OWNER_READMES = [
  'README.md',
  'packages/aot-validator/README.md',
  'packages/app/README.md',
  'packages/jobs/README.md',
  'packages/web/README.md',
] as const;

function markdown(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function manifest(directory: string): {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
} {
  return JSON.parse(markdown(`packages/${directory}/package.json`)) as {
    readonly name?: string;
    readonly version?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
  };
}

function typescriptFences(source: string): string[] {
  const lines = source.split('\n');
  const fences: string[] = [];
  let code: string[] | undefined;

  for (const line of lines) {
    if (code === undefined && /^```(?:ts|typescript)\s*$/.test(line)) {
      code = [];
      continue;
    }
    if (code !== undefined && /^```\s*$/.test(line)) {
      fences.push(`${code.join('\n')}\n`);
      code = undefined;
      continue;
    }
    code?.push(line);
  }

  if (code !== undefined) throw new Error('unterminated TypeScript fence');
  return fences;
}

function compileReadmeSamples(): { readonly status: number | null; readonly output: string } {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-docs-664-'));
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
    const files: string[] = [];
    for (const integration of INTEGRATIONS) {
      const fences = typescriptFences(markdown(`packages/${integration.directory}/README.md`));
      expect(fences, integration.packageName).toHaveLength(1);
      const file = `${integration.directory}.ts`;
      files.push(file);
      writeFileSync(join(temporary, file), fences[0] ?? '');
    }
    writeFileSync(join(temporary, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    writeFileSync(
      join(temporary, 'tsconfig.json'),
      `${JSON.stringify(
        {
          extends: join(ROOT, 'tsconfig.json'),
          compilerOptions: {
            allowImportingTsExtensions: false,
            noEmit: true,
          },
          files,
        },
        null,
        2,
      )}\n`,
    );

    const result = spawnSync('yarn', ['tsc', '--noEmit', '--project', join(temporary, 'tsconfig.json')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: TEST_TIMEOUT,
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

describe('optional server integration documentation (#664)', { timeout: TEST_TIMEOUT }, () => {
  it('publishes exact peers, default-install behavior, and lifecycle ownership', () => {
    const product = manifest('zmdb');
    const defaultDependencies = product.dependencies ?? {};
    const packageReference = markdown('docs-site/content/package-reference.md');

    for (const integration of INTEGRATIONS) {
      const packageManifest = manifest(integration.directory);
      const readme = markdown(`packages/${integration.directory}/README.md`);

      expect(defaultDependencies, integration.packageName).not.toHaveProperty(integration.packageName);
      expect(readme, integration.packageName).toContain('npm add zmdb@alpha');
      expect(readme, integration.packageName).toContain(integration.packageName);
      for (const statement of integration.ownership) expect(readme, integration.packageName).toContain(statement);

      if (integration.peer === undefined) {
        expect(packageManifest.peerDependencies ?? {}).toEqual({});
        expect(readme).toContain('no runtime dependency or peer dependency');
      } else {
        const [peer, range] = integration.peer;
        const externalPeers = Object.fromEntries(
          Object.entries(packageManifest.peerDependencies ?? {}).filter(([name]) => !name.startsWith('@zmdb/')),
        );
        expect(externalPeers).toEqual({ [peer]: range });
        expect(defaultDependencies, peer).not.toHaveProperty(peer);
        expect(readme, integration.packageName).toContain(`${peer}@${range}`);
        const installPeers = Object.entries(packageManifest.peerDependencies ?? {})
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([name, peerRange]) => `${name}@${peerRange}`)
          .join(' ');
        expect(packageReference, integration.packageName).toContain(
          `npm add ${integration.packageName}@${String(packageManifest.version)} ${installPeers}`,
        );
      }
    }
  });

  it('typechecks every TypeScript example in the seven package READMEs', () => {
    const result = compileReadmeSamples();
    expect(result.status, result.output).toBe(0);
  });

  it('keeps supported pages on dedicated packages and rejects removed broad subpaths', () => {
    const supported = Object.entries(PAGE_META)
      .filter(([, meta]) => meta.status === 'supported')
      .map(([slug]) => markdown(`docs-site/content/${slug}.md`))
      .join('\n');
    const packageReadmes = [
      ...INTEGRATIONS.map(integration => markdown(`packages/${integration.directory}/README.md`)),
      ...OWNER_READMES.map(markdown),
    ].join('\n');
    const searchable = `${supported}\n${packageReadmes}`;

    for (const removed of REMOVED_SUBPATHS) expect(searchable, removed).not.toContain(removed);

    expect(markdown('docs-site/content/protobuf-message.md')).toContain('@zmdb/protobuf');
    expect(markdown('docs-site/content/web-microservices-grpc.md')).toContain('@zmdb/transport-grpc');
    expect(markdown('docs-site/content/web-microservices-transports.md')).toContain('@zmdb/transport-nats');
    expect(markdown('docs-site/content/web-microservices-transports.md')).toContain('@zmdb/transport-rabbitmq');
    expect(markdown('docs-site/content/web-microservices-transports.md')).toContain('@zmdb/transport-redis');
    expect(markdown('docs-site/content/web-queues.md')).toContain('@zmdb/jobs-postgres');
    expect(markdown('docs-site/content/web-observability.md')).toContain('@zmdb/otel');
    expect(markdown('docs-site/content/web-tracing.md')).toContain('@zmdb/otel');
  });
});
