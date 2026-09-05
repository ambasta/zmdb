import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ClientResponseError, ResponseValidationError, TransportError, UnexpectedStatusError } from '@zmdb/client';
import { describe, expect, it } from 'vitest';

import {
  ADAPTER_PACKAGES,
  FRAMEWORK_LIFECYCLES,
  createApiClient,
  createControllableAdapterTransport,
  unavailableAdapterSubject,
} from '../../../../fixtures/client-adapters/src/index.js';
import type {
  ActivatedLifecycle,
  AdapterPackageExpectation,
  ApiClient,
  ControllableAdapterTransport,
  HeldAdapterRequest,
  LifecycleHarness,
  PreparedMutation,
  RegisterCleanup,
  Widget,
} from '../../../../fixtures/client-adapters/src/index.js';

const ROOT = process.cwd();
const TYPESCRIPT_HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');

interface PackageManifest {
  readonly name?: string;
  readonly type?: string;
  readonly sideEffects?: boolean;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

interface Activatable {
  activate(registerCleanup: RegisterCleanup): void;
}

function clientFixture(credential?: string): {
  readonly client: ApiClient;
  readonly transport: ControllableAdapterTransport;
} {
  const transport = createControllableAdapterTransport();
  const options =
    credential === undefined
      ? { baseUrl: '/api', transport: transport.transport }
      : {
          baseUrl: '/api',
          transport: transport.transport,
          authentication: () => ({
            requirement: 0,
            headers: { authorization: `Bearer ${credential}` },
          }),
        };
  return { client: createApiClient(options), transport };
}

async function activate<Value extends Activatable>(
  lifecycle: LifecycleHarness,
  value: Value,
): Promise<ActivatedLifecycle<Value>> {
  let failed = false;
  let failure: unknown;
  const owner = await lifecycle.activate(registerCleanup => {
    try {
      value.activate(registerCleanup);
    } catch (error) {
      failed = true;
      failure = error;
    }
    return value;
  });
  if (failed) {
    await owner.dispose();
    throw failure;
  }
  return owner;
}

async function rejectionOf(promise: PromiseLike<unknown>): Promise<unknown> {
  const fulfilled = Symbol('fulfilled');
  const outcome = await Promise.resolve(promise).then(
    () => fulfilled,
    error => error,
  );
  if (outcome === fulfilled) throw new Error('expected promise to reject');
  return outcome;
}

async function flushCompletions(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}

function packageManifest(expectation: AdapterPackageExpectation): PackageManifest {
  const path = join(ROOT, 'packages', expectation.directory, 'package.json');
  if (!existsSync(path)) throw new Error(`${expectation.name} manifest is missing at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

function exportSpecifiers(expectation: AdapterPackageExpectation): readonly string[] {
  return expectation.exports.map(subpath =>
    subpath === '.' ? expectation.name : `${expectation.name}/${subpath.slice('./'.length)}`,
  );
}

function importWithoutEffects(expectation: AdapterPackageExpectation): ReturnType<typeof spawnSync> {
  const source = `
const before = new Set(Reflect.ownKeys(globalThis));
let requests = 0;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value() {
    requests += 1;
    throw new Error('adapter import attempted network I/O');
  },
});
for (const specifier of ${JSON.stringify(exportSpecifiers(expectation))}) {
  await import(specifier);
}
const added = Reflect.ownKeys(globalThis).filter(key => !before.has(key) && key !== 'fetch').map(String);
if (requests !== 0) throw new Error('adapter import executed network I/O');
if (added.length !== 0) throw new Error('adapter import registered globals: ' + added.join(', '));
`;
  return spawnSync(process.execPath, [`--import=${TYPESCRIPT_HOOK}`, '--input-type=module', '--eval', source], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

async function requestsOrFailure(
  transport: ControllableAdapterTransport,
  operations: readonly Promise<unknown>[],
): Promise<readonly [HeldAdapterRequest, HeldAdapterRequest]> {
  const requests = Promise.all([transport.nextRequest(), transport.nextRequest()]);
  const failure = Promise.race(
    operations.map(operation =>
      operation.then(
        () => new Promise<never>(() => undefined),
        error => Promise.reject(error),
      ),
    ),
  );
  return Promise.race([requests, failure]);
}

function packageCycle(): readonly string[] | null {
  const graph = new Map<string, Set<string>>();
  for (const expectation of ADAPTER_PACKAGES) {
    const targets = new Set(Object.keys(expectation.dependencies).filter(dependency => dependency !== '@zmdb/client'));
    graph.set(expectation.name, targets);
    for (const target of targets) {
      if (!graph.has(target)) graph.set(target, new Set());
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): readonly string[] | null => {
    if (visiting.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (visited.has(node)) return null;
    visiting.add(node);
    path.push(node);
    for (const target of graph.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle !== null) return cycle;
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== null) return cycle;
  }
  return null;
}

describe('the shared generated adapter fixture (#689)', () => {
  it('executes one generated @zmdb/client fixture through the controllable transport', async () => {
    const { client, transport } = clientFixture();
    const pending = client.getWidget({ id: 'widget/one' });
    const held = await transport.nextRequest();
    expect(held.request.url).toBe('/api/widgets/widget%2Fone');
    expect(held.request.headers).toEqual({ accept: 'application/json' });
    held.respondJson(200, { id: 'widget/one', name: 'One' });
    await expect(pending).resolves.toEqual({ id: 'widget/one', name: 'One' });
  });

  it('exposes protocol, validation, documented-error and abort outcomes without a second client', async () => {
    const { client, transport } = clientFixture();

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
    held.respondJson(200, { id: 'aborted', name: 'late' });
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
});

describe.each(ADAPTER_PACKAGES)('$name executable adapter contract', packageExpectation => {
  const lifecycle = FRAMEWORK_LIFECYCLES[packageExpectation.lifecycle];
  const subject = unavailableAdapterSubject<ApiClient>(packageExpectation);

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('does not request before the framework primitive activates', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'one' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    expect(query.snapshot).toEqual({ data: undefined, error: undefined, loading: false });
    expect(transport.requests).toEqual([]);

    const owner = await activate(lifecycle, query);
    try {
      expect(transport.requests).toHaveLength(1);
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('publishes pending and success through the framework primitive', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'one' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    try {
      const request = await transport.nextRequest();
      expect(query.snapshot).toEqual({ data: undefined, error: undefined, loading: true });
      request.respondJson(200, { id: 'one', name: 'First' });
      await query.whenSettled();
      expect(query.snapshot).toEqual({
        data: { id: 'one', name: 'First' },
        error: undefined,
        loading: false,
      });
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('cancels when the owning scope is disposed', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'one' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    const request = await transport.nextRequest();
    await owner.dispose();
    expect(request.request.signal?.aborted).toBe(true);
    expect(query.snapshot.error).toBeUndefined();
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('ignores a stale response after inputs change', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'first' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    try {
      const first = await transport.nextRequest();
      query.changeInput({ id: 'second' });
      const second = await transport.nextRequest();
      expect(first.request.signal?.aborted).toBe(true);
      second.respondJson(200, { id: 'second', name: 'Second' });
      await query.whenSettled();
      first.respondJson(200, { id: 'first', name: 'Late first' });
      await flushCompletions();
      expect(query.snapshot).toEqual({
        data: { id: 'second', name: 'Second' },
        error: undefined,
        loading: false,
      });
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('preserves ClientResponseError identity', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'one' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    try {
      (await transport.nextRequest()).respondJson(200, { id: 'one', name: 'First' });
      await query.whenSettled();

      const refreshed = query.refresh();
      (await transport.nextRequest()).respondJson(404, { code: 'missing', message: 'not found' });
      const error = await rejectionOf(refreshed);
      expect(error).toBeInstanceOf(ClientResponseError);
      expect(query.snapshot.error).toBe(error);
      expect(query.snapshot.data).toEqual({ id: 'one', name: 'First' });
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('preserves protocol errors from the generated client', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'protocol' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    try {
      (await transport.nextRequest()).respondText(418, 'short teapot');
      await query.whenSettled();
      expect(query.snapshot.error).toBeInstanceOf(UnexpectedStatusError);
      expect(query.snapshot.loading).toBe(false);
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('preserves response validation errors from the generated client', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'validation' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    try {
      (await transport.nextRequest()).respondJson(200, { id: 1, name: 'invalid' });
      await query.whenSettled();
      expect(query.snapshot.error).toBeInstanceOf(ResponseValidationError);
      expect(query.snapshot.loading).toBe(false);
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('does not retry without explicit policy', async () => {
    const { client, transport } = clientFixture();
    const query = subject.prepareQuery({
      client,
      input: { id: 'one' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    try {
      (await transport.nextRequest()).fail(new Error('transport unavailable'));
      await query.whenSettled();
      await flushCompletions();
      expect(query.snapshot.error).toBeInstanceOf(TransportError);
      expect(transport.requests).toHaveLength(1);
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no query primitive implementation".
  it.fails('accepts a generated client without inspecting its contract', async () => {
    const { client, transport } = clientFixture();
    const opaqueClient = new Proxy(client, {
      get(target, property, receiver) {
        if (property !== 'getWidget') {
          throw new Error(`${packageExpectation.name} inspected generated-client property ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
      getPrototypeOf() {
        throw new Error(`${packageExpectation.name} inspected the generated-client prototype`);
      },
      ownKeys() {
        throw new Error(`${packageExpectation.name} enumerated the generated-client contract`);
      },
    });
    const query = subject.prepareQuery({
      client: opaqueClient,
      input: { id: 'opaque' },
      load: (api, input, signal) => api.getWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, query);
    try {
      (await transport.nextRequest()).respondJson(200, { id: 'opaque', name: 'Opaque' });
      await query.whenSettled();
      expect(query.snapshot.data).toEqual({ id: 'opaque', name: 'Opaque' });
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: activation throws "<package> has no mutation primitive implementation".
  it.fails('keeps concurrent mutation promises independent and only the newest error visible', async () => {
    const { client, transport } = clientFixture();
    const mutation: PreparedMutation<{ readonly id: string; readonly name: string }, Widget> = subject.prepareMutation({
      client,
      run: (api, input, signal) => api.renameWidget(input, { signal }),
    });
    const owner = await activate(lifecycle, mutation);
    try {
      const firstPromise = mutation.mutate({ id: 'one', name: 'First' });
      const first = await transport.nextRequest();
      const secondPromise = mutation.mutate({ id: 'two', name: 'Second' });
      const second = await transport.nextRequest();
      expect(first.request.signal?.aborted).toBe(false);
      expect(mutation.snapshot.pending).toBe(true);

      second.respondJson(200, { id: 'two', name: 'Second' });
      await expect(secondPromise).resolves.toEqual({ id: 'two', name: 'Second' });
      first.respondJson(409, { code: 'conflict', message: 'older mutation failed' });
      await expect(firstPromise).rejects.toBeInstanceOf(ClientResponseError);
      expect(mutation.snapshot).toEqual({ error: undefined, pending: false });
    } finally {
      await owner.dispose();
    }
  });

  // Measured at cd75aed4: the subject rejects with "<package> has no request-scoped SSR implementation".
  it.fails('does not share request state across SSR requests', async () => {
    const transport = createControllableAdapterTransport();
    const firstClient = createApiClient({
      baseUrl: '/api',
      transport: transport.transport,
      authentication: () => ({
        requirement: 0,
        headers: { authorization: 'Bearer first-credential' },
      }),
    });
    const secondClient = createApiClient({
      baseUrl: '/api',
      transport: transport.transport,
      authentication: () => ({
        requirement: 0,
        headers: { authorization: 'Bearer second-credential' },
      }),
    });
    const firstResult = subject.runSsrQuery({
      client: firstClient,
      input: { id: 'first' },
      load: (api, input, signal) => api.getPrivateWidget(input, { signal }),
    });
    const secondResult = subject.runSsrQuery({
      client: secondClient,
      input: { id: 'second' },
      load: (api, input, signal) => api.getPrivateWidget(input, { signal }),
    });
    const requests = await requestsOrFailure(transport, [firstResult, secondResult]);
    const byUrl = requests.toSorted((left, right) => left.request.url.localeCompare(right.request.url));
    expect(byUrl.map(request => request.request.headers.authorization)).toEqual([
      'Bearer first-credential',
      'Bearer second-credential',
    ]);
    const [firstRequest, secondRequest] = byUrl;
    if (firstRequest === undefined || secondRequest === undefined) {
      throw new Error('SSR isolation did not dispatch two requests');
    }
    secondRequest.respondJson(200, { id: 'second', name: 'Second' });
    firstRequest.respondJson(200, { id: 'first', name: 'First' });
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
      { id: 'first', name: 'First' },
      { id: 'second', name: 'Second' },
    ]);
  });

  // Measured at cd75aed4: every adapter specifier rejects with ERR_MODULE_NOT_FOUND.
  it.fails('imports without executing network I/O', () => {
    const result = importWithoutEffects(packageExpectation);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  // Measured at cd75aed4: packages/<adapter>/package.json is absent for all nine adapters.
  it.fails('framework package has only expected peers', () => {
    const manifest = packageManifest(packageExpectation);
    expect(manifest.name).toBe(packageExpectation.name);
    expect(manifest.type).toBe('module');
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.dependencies).toEqual(packageExpectation.dependencies);
    expect(manifest.peerDependencies).toEqual(packageExpectation.peerDependencies);
    expect(Object.keys(manifest.exports ?? {}).toSorted()).toEqual([...packageExpectation.exports].toSorted());
    const optionalPeers = Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata.optional === true)
      .map(([name]) => name)
      .toSorted();
    expect(optionalPeers).toEqual([...packageExpectation.optionalPeers].toSorted());
  });
});

describe('adapter package qualification design (#689)', () => {
  it('every proposed package names framework behaviour unavailable from @zmdb/client alone', () => {
    expect(ADAPTER_PACKAGES).toHaveLength(9);
    expect(new Set(ADAPTER_PACKAGES.map(expectation => expectation.qualifyingBehaviour)).size).toBe(9);
    for (const expectation of ADAPTER_PACKAGES) {
      expect(expectation.qualifyingBehaviour.length, expectation.name).toBeGreaterThan(20);
    }
  });

  it('the dependency graph from meta-framework to base adapter is acyclic', () => {
    expect(packageCycle()).toBeNull();
    expect(
      ADAPTER_PACKAGES.filter(expectation => Object.keys(expectation.dependencies).length > 1).map(
        expectation => expectation.name,
      ),
    ).toEqual(['@zmdb/react-native', '@zmdb/next', '@zmdb/nuxt', '@zmdb/sveltekit']);
  });
});
