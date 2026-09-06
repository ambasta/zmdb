import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { publishManifest, publishTrain } from '../../../.github/scripts/lib/publish-manifest.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
  type PackedProjectResult,
} from '../../../fixtures/client-adapters/src/packed-project.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RELEASE_VERSION = (await publishTrain(ROOT)).version;
const CLIENT = join(ROOT, 'packages/client');
const SOLID = join(ROOT, 'packages/solid');
const HARNESS = join(ROOT, 'fixtures/client-adapters/src');

const fixtureFiles = [
  'conformance-cases.ts',
  'controllable-transport.ts',
  'generated/api.generated.ts',
  'package-matrix.ts',
  'solid-binding.ts',
  'ssr.ts',
] as const;

const packedConformance = `
import type { AdapterPackageExpectation } from './package-matrix.js';

export type QueryLoader<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AbortSignal,
) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AbortSignal,
) => PromiseLike<Output>;

export interface QuerySnapshot<Output> {
  readonly data: Output | undefined;
  readonly error: unknown;
  readonly loading: boolean;
}

export interface MutationSnapshot {
  readonly error: unknown;
  readonly pending: boolean;
}

export interface ConformanceQuery<Input, Output> {
  snapshot(): QuerySnapshot<Output>;
  mount(): Promise<void>;
  update(input: Input): Promise<void>;
  refresh(): Promise<void>;
  whenSettled(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ConformanceMutation<Input, Output> {
  snapshot(): MutationSnapshot;
  mount(): Promise<void>;
  mutate(input: Input): Promise<Output>;
  dispose(): Promise<void>;
}

export interface AdapterConformanceBinding<Client> {
  readonly package: AdapterPackageExpectation;
  prepareQuery<Input, Output>(options: {
    readonly client: Client;
    readonly input: Input;
    readonly load: QueryLoader<Client, Input, Output>;
  }): ConformanceQuery<Input, Output>;
  prepareMutation<Input, Output>(options: {
    readonly client: Client;
    readonly run: MutationRunner<Client, Input, Output>;
  }): ConformanceMutation<Input, Output>;
  runSsrQuery<Input, Output>(options: {
    readonly client: Client;
    readonly input: Input;
    readonly load: QueryLoader<Client, Input, Output>;
  }): Promise<Output>;
}
`;

function manifest(directory: string): Readonly<Record<string, unknown>> {
  return publishManifest(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')), RELEASE_VERSION);
}

function build(packageName: string): void {
  const buildResult = spawnSync('yarn', ['workspace', packageName, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (buildResult.status !== 0) {
    throw new Error(
      `${packageName} build failed with ${String(buildResult.status)}\n${buildResult.stdout}\n${buildResult.stderr}`,
    );
  }
}

function harnessFiles(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    fixtureFiles.map(path => [`src/harness/${path}`, readFileSync(join(HARNESS, path), 'utf8')]),
  );
}

const browserEntry = `
import {
  assertClientResponseErrorIdentity,
  assertDisposalCancellation,
  assertIndependentMutations,
  assertNoImplicitRetry,
  assertNoRequestBeforeMount,
  assertOpaqueGeneratedClient,
  assertPendingAndSuccess,
  assertProtocolErrorIdentity,
  assertStaleResultSuppression,
  assertValidationErrorIdentity,
} from './harness/conformance-cases.js';
import type { ApiClient } from './harness/generated/api.generated.js';
import { createSolidAdapterBinding } from './harness/solid-binding.js';

const binding = createSolidAdapterBinding<ApiClient>();
await assertNoRequestBeforeMount(binding);
await assertPendingAndSuccess(binding);
await assertDisposalCancellation(binding);
await assertStaleResultSuppression(binding);
await assertClientResponseErrorIdentity(binding);
await assertProtocolErrorIdentity(binding);
await assertValidationErrorIdentity(binding);
await assertNoImplicitRetry(binding);
await assertOpaqueGeneratedClient(binding);
await assertIndependentMutations(binding);
process.stdout.write(JSON.stringify({ environment: 'browser', cases: 10 }));
`;

const serverEntry = `
import type { ApiClient } from './harness/generated/api.generated.js';
import { createSolidAdapterBinding } from './harness/solid-binding.js';
import { assertSsrCredentialIsolation } from './harness/ssr.js';

await assertSsrCredentialIsolation(createSolidAdapterBinding<ApiClient>());
process.stdout.write(JSON.stringify({ environment: 'server', isolated: true }));
`;

let result: PackedProjectResult;

beforeAll(() => {
  result = runPackedProject({
    name: 'zmdb-solid-packed-consumer',
    packages: [
      { directory: CLIENT, manifest: manifest(CLIENT) },
      { directory: SOLID, manifest: manifest(SOLID) },
    ],
    buildLockRoot: ROOT,
    preparePackages() {
      build('@zmdb/client');
      build('@zmdb/solid');
    },
    dependencies: {
      'solid-js': '1.9.15',
    },
    devDependencies: {
      '@types/node': '26.4.1',
      esbuild: '0.28.2',
      typescript: '7.0.2',
    },
    files: {
      ...harnessFiles(),
      'src/harness/conformance.ts': packedConformance,
      'src/browser.ts': browserEntry,
      'src/server.ts': serverEntry,
      'tsconfig.json': `${JSON.stringify(
        {
          compilerOptions: {
            exactOptionalPropertyTypes: true,
            lib: ['ESNext', 'DOM'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            noUncheckedIndexedAccess: true,
            strict: true,
            target: 'ESNext',
            types: ['node'],
            verbatimModuleSyntax: true,
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      )}\n`,
    },
    commands: [
      {
        label: 'packed Solid consumer typecheck',
        command: 'npx',
        arguments: ['tsc', '--noEmit', '-p', 'tsconfig.json'],
      },
      {
        label: 'packed Solid browser bundle',
        command: 'npx',
        arguments: [
          'esbuild',
          'src/browser.ts',
          '--bundle',
          '--platform=node',
          '--format=esm',
          '--conditions=browser',
          '--outfile=dist/browser.mjs',
        ],
      },
      {
        label: 'packed Solid browser runtime',
        command: 'node',
        arguments: ['dist/browser.mjs'],
      },
      {
        label: 'packed Solid SSR bundle',
        command: 'npx',
        arguments: [
          'esbuild',
          'src/server.ts',
          '--bundle',
          '--platform=node',
          '--format=esm',
          '--conditions=node',
          '--outfile=dist/server.mjs',
        ],
      },
      {
        label: 'packed Solid SSR runtime',
        command: 'node',
        arguments: ['dist/server.mjs'],
      },
    ],
  });
}, PACKED_BUILD_TEST_TIMEOUT_MS);

afterAll(() => {
  result?.cleanup();
});

describe('packed @zmdb/solid browser and SSR consumers (#695)', () => {
  it('passes common conformance from installed browser-condition tarballs', () => {
    const command = result.commands.find(candidate => candidate.label === 'packed Solid browser runtime');
    expect(command?.status).toBe(0);
    expect(JSON.parse(command?.stdout ?? '')).toEqual({ environment: 'browser', cases: 10 });
  });

  it('isolates request state from installed SSR tarballs', () => {
    const command = result.commands.find(candidate => candidate.label === 'packed Solid SSR runtime');
    expect(command?.status).toBe(0);
    expect(JSON.parse(command?.stdout ?? '')).toEqual({ environment: 'server', isolated: true });
  });
});
