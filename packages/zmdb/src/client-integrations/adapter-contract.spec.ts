import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClientResponseError, ResponseValidationError, UnexpectedStatusError } from '@zmdb/client';
import { describe, expect, it } from 'vitest';

import {
  ADAPTER_PACKAGES,
  FRAMEWORK_LIFECYCLES,
  adapterManifestProblems,
  adapterPackageCycle,
  assertAdapterImportsWithoutEffects,
  assertAdapterPackageManifest,
  assertClientResponseErrorIdentity,
  assertDisposalCancellation,
  assertIndependentMutations,
  assertNoImplicitRetry,
  assertNoRequestBeforeMount,
  assertOpaqueGeneratedClient,
  assertPendingAndSuccess,
  assertProtocolErrorIdentity,
  assertSsrCredentialIsolation,
  assertStaleResultSuppression,
  assertValidationErrorIdentity,
  bindPreparedAdapterSubject,
  createAngularConformanceBinding,
  createAdapterClientFixture,
  createApiClient,
  createControllableAdapterTransport,
  createNextConformanceBinding,
  createReactConformanceBinding,
  createSvelteAdapterConformanceBinding,
  createVueConformanceBinding,
  privateHarnessProductionLeaks,
  readAdapterPackageManifest,
  runPackedProject,
  unavailableAdapterSubject,
} from '../../../../fixtures/client-adapters/src/index.js';
import type {
  AdapterConformanceBinding,
  AdapterPackageExpectation,
  ApiClient,
} from '../../../../fixtures/client-adapters/src/index.js';
import {
  createHarnessSelfTestBinding,
  createLifecycleSelfTestSubject,
} from '../../../../fixtures/client-adapters/src/self-test-binding.js';

const ROOT = process.cwd();

function expectationFor(name: AdapterPackageExpectation['name']): AdapterPackageExpectation {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === name);
  if (expectation === undefined) throw new Error(`missing adapter package expectation ${name}`);
  return expectation;
}

type ContractCase = (title: string, run: () => void | Promise<void>) => void;

function registerExecutableAdapterContract(
  contract: ContractCase,
  binding: AdapterConformanceBinding<ApiClient>,
): void {
  contract('does not request before the framework primitive activates', () => assertNoRequestBeforeMount(binding));

  contract('publishes pending and success through the framework primitive', () => assertPendingAndSuccess(binding));

  contract('cancels when the owning scope is disposed', () => assertDisposalCancellation(binding));

  contract('ignores a stale response after inputs change', () => assertStaleResultSuppression(binding));

  contract('preserves ClientResponseError identity', () => assertClientResponseErrorIdentity(binding));

  contract('preserves protocol errors from the generated client', () => assertProtocolErrorIdentity(binding));

  contract('preserves response validation errors from the generated client', () =>
    assertValidationErrorIdentity(binding),
  );

  contract('does not retry without explicit policy', () => assertNoImplicitRetry(binding));

  contract('accepts a generated client without inspecting its contract', () => assertOpaqueGeneratedClient(binding));

  contract('keeps concurrent mutation promises independent and only the newest error visible', () =>
    assertIndependentMutations(binding),
  );

  contract('does not share request state across SSR requests', () => assertSsrCredentialIsolation(binding));

  contract('imports without executing network I/O', () => {
    assertAdapterImportsWithoutEffects(ROOT, binding.package);
  });

  contract('framework package has only expected peers', () => {
    assertAdapterPackageManifest(binding.package, readAdapterPackageManifest(ROOT, binding.package));
  });
}

const UNAVAILABLE_ADAPTER_PACKAGES = ADAPTER_PACKAGES.filter(
  expectation =>
    expectation.name !== '@zmdb/react' &&
    expectation.name !== '@zmdb/angular' &&
    expectation.name !== '@zmdb/vue' &&
    expectation.name !== '@zmdb/svelte' &&
    expectation.name !== '@zmdb/next',
);

describe('the shared generated adapter fixture (#689, #690)', () => {
  it('the generated fixture client runs through the fake transport', async () => {
    const { client, transport } = createAdapterClientFixture('fixture-credential');

    const query = client.getWidget({ id: 'widget/one' });
    const queryRequest = await transport.nextRequest();
    expect(queryRequest.request.url).toBe('/api/widgets/widget%2Fone');
    expect(queryRequest.request.headers).toEqual({ accept: 'application/json' });
    queryRequest.respondJson(200, { id: 'widget/one', name: 'One' });
    await expect(query).resolves.toEqual({ id: 'widget/one', name: 'One' });

    const mutation = client.renameWidget({ id: 'widget/one', name: 'Renamed' });
    const mutationRequest = await transport.nextRequest();
    expect(mutationRequest.request.method).toBe('PATCH');
    expect(mutationRequest.request.body).toBe('{"name":"Renamed"}');
    mutationRequest.respondJson(202, { id: 'widget/one', name: 'Renamed' });
    await expect(mutation).resolves.toEqual({ id: 'widget/one', name: 'Renamed' });

    const authenticated = client.getPrivateWidget({ id: 'private' });
    const authenticatedRequest = await transport.nextRequest();
    expect(authenticatedRequest.request.headers.authorization).toBe('Bearer fixture-credential');
    authenticatedRequest.respondJson(200, { id: 'private', name: 'Private' });
    await expect(authenticated).resolves.toEqual({ id: 'private', name: 'Private' });
    transport.assertIdle('generated fixture client');
  });

  it('exposes protocol, validation, documented-error and abort outcomes without a second client', async () => {
    const { client, transport } = createAdapterClientFixture();

    const protocol = client.getWidget({ id: 'protocol' });
    (await transport.nextRequest()).respondText(418, 'short teapot');
    await expect(protocol).rejects.toBeInstanceOf(UnexpectedStatusError);

    const validation = client.getWidget({ id: 'validation' });
    (await transport.nextRequest()).respondJson(200, { id: 1, name: 'invalid' });
    await expect(validation).rejects.toBeInstanceOf(ResponseValidationError);

    const documented = client.getWidget({ id: 'missing' });
    (await transport.nextRequest()).respondJson(404, { code: 'missing', message: 'not found' });
    await expect(documented).rejects.toBeInstanceOf(ClientResponseError);

    const controller = new AbortController();
    const reason = new Error('fixture owner disposed');
    const aborted = client.getWidget({ id: 'aborted' }, { signal: controller.signal });
    const held = await transport.nextRequest();
    controller.abort(reason);
    await expect(aborted).rejects.toBe(reason);
    await expect(held.whenAborted()).resolves.toBe(reason);
    expect(held.abortReason).toBe(reason);
    expect(held.state).toBe('aborted');
    transport.assertIdle('generated fixture outcomes');
  });

  it('records exact abort reasons and out-of-order completion', async () => {
    const transport = createControllableAdapterTransport();
    const client = createApiClient({ baseUrl: '/api', transport: transport.transport });
    const firstResult = client.getWidget({ id: 'first' });
    const first = await transport.nextRequest();
    const secondResult = client.getWidget({ id: 'second' });
    const second = await transport.nextRequest();

    second.respondJson(200, { id: 'second', name: 'Second' });
    first.respondJson(200, { id: 'first', name: 'First' });
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
      { id: 'first', name: 'First' },
      { id: 'second', name: 'Second' },
    ]);
    expect(transport.settlements.map(settlement => settlement.sequence)).toEqual([2, 1]);

    const controller = new AbortController();
    const reason = Object.freeze({ kind: 'adapter-dispose', owner: 'probe' });
    const aborted = client.getWidget({ id: 'aborted' }, { signal: controller.signal });
    const third = await transport.nextRequest();
    controller.abort(reason);
    await expect(aborted).rejects.toBe(reason);
    await expect(third.whenAborted()).resolves.toBe(reason);
    expect(transport.settlements.at(-1)).toEqual({ sequence: 3, kind: 'abort', reason });
    transport.assertIdle('transport ledger');
  });
});

describe('adapter harness self-detection (#690)', () => {
  const expectation = expectationFor('@zmdb/react');

  it('the harness detects a leaked request after disposal', async () => {
    const binding = createHarnessSelfTestBinding<ApiClient>(expectation, { leakOnDispose: true });
    await expect(assertDisposalCancellation(binding)).rejects.toThrow('leaked 1 request');
  });

  it('the harness detects a stale result overwriting a newer result', async () => {
    const binding = createHarnessSelfTestBinding<ApiClient>(expectation, {
      overwriteWithStaleResult: true,
    });
    await expect(assertStaleResultSuppression(binding)).rejects.toThrow(
      'allowed a stale result to overwrite the newer result',
    );
  });

  it('the harness detects shared SSR credentials', async () => {
    const binding = createHarnessSelfTestBinding<ApiClient>(expectation, { shareSsrClient: true });
    await expect(assertSsrCredentialIsolation(binding)).rejects.toThrow('shared SSR credentials');
  });

  it('the harness detects an undeclared framework dependency', () => {
    expect(() =>
      assertAdapterPackageManifest(expectation, {
        name: expectation.name,
        type: 'module',
        sideEffects: false,
        exports: { '.': './src/index.ts' },
        dependencies: expectation.dependencies,
        peerDependencies: {},
        peerDependenciesMeta: { '@types/react': { optional: true } },
      }),
    ).toThrow('undeclared framework dependency react');
  });

  it('manifest rules reject server, ORM, database and duplicated HTTP dependencies', () => {
    const forbidden = [
      ['@zmdb/web', 'server dependency'],
      ['@zmdb/orm', 'ORM or database dependency'],
      ['pg', 'ORM or database dependency'],
      ['axios', 'duplicated HTTP dependency'],
    ] as const;
    for (const [dependency, category] of forbidden) {
      const problems = adapterManifestProblems(expectation, {
        name: expectation.name,
        type: 'module',
        sideEffects: false,
        exports: { '.': './src/index.ts' },
        dependencies: { ...expectation.dependencies, [dependency]: '1.0.0' },
        peerDependencies: expectation.peerDependencies,
        peerDependenciesMeta: { '@types/react': { optional: true } },
      });
      expect(
        problems.some(problem => problem.includes(`${category} ${dependency}`)),
        dependency,
      ).toBe(true);
    }
  });

  it('packed consumer helpers install tarballs rather than workspace sources', () => {
    const source = mkdtempSync(join(tmpdir(), 'zmdb-adapter-package-'));
    let result: ReturnType<typeof runPackedProject> | undefined;
    try {
      writeFileSync(
        join(source, 'package.json'),
        `${JSON.stringify(
          {
            name: '@fixture/adapter',
            version: '1.0.0',
            type: 'module',
            exports: { '.': './index.js' },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(join(source, 'index.js'), "export const installedFrom = 'tarball';\n");
      result = runPackedProject({
        name: '@fixture/adapter-consumer',
        packages: [{ directory: source }],
        files: {
          'probe.mjs': "import { installedFrom } from '@fixture/adapter';\nprocess.stdout.write(installedFrom);\n",
        },
        commands: [
          {
            label: 'packed adapter probe',
            command: process.execPath,
            arguments: ['probe.mjs'],
          },
        ],
      });
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0]?.stdout).toBe('tarball');
    } finally {
      result?.cleanup();
      rmSync(source, { recursive: true, force: true });
    }
  });

  it('keeps the private conformance harness out of production packages', () => {
    expect(privateHarnessProductionLeaks(ROOT)).toEqual([]);
  });
});

describe.each(Object.values(FRAMEWORK_LIFECYCLES))('the real $name lifecycle fixture', lifecycle => {
  it('activates lazily and disposes through the framework primitive', async () => {
    const events: string[] = [];
    const owner = await lifecycle.activate(registerCleanup => {
      events.push('activate');
      registerCleanup(() => events.push('dispose'));
      return lifecycle.name;
    });
    expect(owner.value).toBe(lifecycle.name);
    expect(events).toEqual(['activate']);
    await owner.dispose();
    await owner.dispose();
    expect(events).toEqual(['activate', 'dispose']);
  });

  it('runs common conformance through the framework mount and disposal', async () => {
    const expectation = ADAPTER_PACKAGES.find(candidate => candidate.lifecycle === lifecycle.name);
    if (expectation === undefined) throw new Error(`no package uses the ${lifecycle.name} lifecycle`);
    const subject = createLifecycleSelfTestSubject(createHarnessSelfTestBinding<ApiClient>(expectation));
    const binding = bindPreparedAdapterSubject(subject, lifecycle);
    await assertPendingAndSuccess(binding);
    await assertDisposalCancellation(binding);
  });
});

describe('@zmdb/react executable adapter contract', () => {
  registerExecutableAdapterContract(it, createReactConformanceBinding<ApiClient>());
});

describe('@zmdb/angular executable adapter contract', () => {
  registerExecutableAdapterContract(it, createAngularConformanceBinding<ApiClient>(expectationFor('@zmdb/angular')));
});

describe('@zmdb/vue executable adapter contract', () => {
  registerExecutableAdapterContract(it, createVueConformanceBinding<ApiClient>());
});

describe('@zmdb/svelte executable adapter contract', () => {
  const expectation = expectationFor('@zmdb/svelte');
  const binding = createSvelteAdapterConformanceBinding();

  it('does not request before the framework primitive activates', () => assertNoRequestBeforeMount(binding));

  it('publishes pending and success through the framework primitive', () => assertPendingAndSuccess(binding));

  it('cancels when the owning scope is disposed', () => assertDisposalCancellation(binding));

  it('ignores a stale response after inputs change', () => assertStaleResultSuppression(binding));

  it('preserves ClientResponseError identity', () => assertClientResponseErrorIdentity(binding));

  it('preserves protocol errors from the generated client', () => assertProtocolErrorIdentity(binding));

  it('preserves response validation errors from the generated client', () => assertValidationErrorIdentity(binding));

  it('does not retry without explicit policy', () => assertNoImplicitRetry(binding));

  it('accepts a generated client without inspecting its contract', () => assertOpaqueGeneratedClient(binding));

  it('keeps concurrent mutation promises independent and only the newest error visible', () =>
    assertIndependentMutations(binding));

  it('does not share request state across SSR requests', () => assertSsrCredentialIsolation(binding));

  it('imports without executing network I/O', () => {
    assertAdapterImportsWithoutEffects(ROOT, expectation);
  });

  it('framework package has only expected peers', () => {
    assertAdapterPackageManifest(expectation, readAdapterPackageManifest(ROOT, expectation));
  });
});

describe('@zmdb/next executable adapter contract', () => {
  const expectation = expectationFor('@zmdb/next');
  const binding = createNextConformanceBinding<ApiClient>();

  it('does not request before the framework primitive activates', () => assertNoRequestBeforeMount(binding));

  it('publishes pending and success through the framework primitive', () => assertPendingAndSuccess(binding));

  it('cancels when the owning scope is disposed', () => assertDisposalCancellation(binding));

  it('ignores a stale response after inputs change', () => assertStaleResultSuppression(binding));

  it('preserves ClientResponseError identity', () => assertClientResponseErrorIdentity(binding));

  it('preserves protocol errors from the generated client', () => assertProtocolErrorIdentity(binding));

  it('preserves response validation errors from the generated client', () => assertValidationErrorIdentity(binding));

  it('does not retry without explicit policy', () => assertNoImplicitRetry(binding));

  it('accepts a generated client without inspecting its contract', () => assertOpaqueGeneratedClient(binding));

  it('keeps concurrent mutation promises independent and only the newest error visible', () =>
    assertIndependentMutations(binding));

  it('does not share request state across SSR requests', () => assertSsrCredentialIsolation(binding));

  it('imports without executing network I/O', () => {
    assertAdapterImportsWithoutEffects(ROOT, expectation);
  });

  it('framework package has only expected peers', () => {
    assertAdapterPackageManifest(expectation, readAdapterPackageManifest(ROOT, expectation));
  });
});

describe.each(UNAVAILABLE_ADAPTER_PACKAGES)('$name executable adapter contract', expectation => {
  const lifecycle = FRAMEWORK_LIFECYCLES[expectation.lifecycle];
  const binding: AdapterConformanceBinding<ApiClient> = bindPreparedAdapterSubject(
    unavailableAdapterSubject<ApiClient>(expectation),
    lifecycle,
  );
  registerExecutableAdapterContract(it.fails, binding);
});

describe('adapter package qualification design (#689, #690)', () => {
  it('every proposed package names framework behaviour unavailable from @zmdb/client alone', () => {
    expect(ADAPTER_PACKAGES).toHaveLength(9);
    expect(new Set(ADAPTER_PACKAGES.map(expectation => expectation.qualifyingBehaviour)).size).toBe(9);
    for (const expectation of ADAPTER_PACKAGES) {
      expect(expectation.qualifyingBehaviour.length, expectation.name).toBeGreaterThan(20);
    }
  });

  it('the dependency graph from meta-framework to base adapter is acyclic', () => {
    expect(adapterPackageCycle(ADAPTER_PACKAGES)).toBeNull();
    expect(
      ADAPTER_PACKAGES.filter(expectation => Object.keys(expectation.dependencies).length > 1).map(
        expectation => expectation.name,
      ),
    ).toEqual(['@zmdb/react-native', '@zmdb/next', '@zmdb/nuxt', '@zmdb/sveltekit']);
  });
});
