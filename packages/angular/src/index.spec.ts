import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import type { EnvironmentInjector } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertAdapterImportsWithoutEffects,
  assertSsrCredentialIsolation,
  createAdapterClientFixture,
  createAngularConformanceBinding,
  flushAdapterCompletions,
  type ApiClient,
} from '../../../fixtures/client-adapters/src/index.js';
import { ADAPTER_PACKAGES } from '../../../fixtures/client-adapters/src/package-matrix.js';
import { createZmdbAngular } from './index.js';

const ROOT = process.cwd();
const bindings = createZmdbAngular<ApiClient>('Angular adapter test client');
const injectors: EnvironmentInjector[] = [];

function rootInjector(name: string): EnvironmentInjector {
  const injector = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector, name);
  injectors.push(injector);
  return injector;
}

function childInjector(parent: EnvironmentInjector, name: string, client?: ApiClient): EnvironmentInjector {
  const providers = client === undefined ? [] : [bindings.provideZmdbClient(client)];
  const injector = createEnvironmentInjector(providers, parent, name);
  injectors.push(injector);
  return injector;
}

function angularExpectation() {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === '@zmdb/angular');
  if (expectation === undefined) throw new Error('missing @zmdb/angular package expectation');
  return expectation;
}

afterEach(() => {
  for (const injector of injectors.splice(0).toReversed()) {
    if (!injector.destroyed) injector.destroy();
  }
});

describe('@zmdb/angular native package contract (#692)', () => {
  it('isolates clients across injector hierarchies', () => {
    const first = createAdapterClientFixture().client;
    const second = createAdapterClientFixture().client;
    const root = rootInjector('client-hierarchy-root');
    const parent = childInjector(root, 'client-hierarchy-parent', first);
    const inherited = childInjector(parent, 'client-hierarchy-inherited');
    const overridden = childInjector(parent, 'client-hierarchy-overridden', second);

    expect(runInInjectionContext(parent, bindings.injectZmdbClient)).toBe(first);
    expect(runInInjectionContext(inherited, bindings.injectZmdbClient)).toBe(first);
    expect(runInInjectionContext(overridden, bindings.injectZmdbClient)).toBe(second);
  });

  it('DestroyRef aborts an active request', async () => {
    const { client, transport } = createAdapterClientFixture();
    const root = rootInjector('destroy-root');
    const owner = childInjector(root, 'destroy-owner', client);
    const query = runInInjectionContext(owner, () =>
      bindings.zmdbQuery({ id: 'query' }, (api, input, signal) => api.getWidget(input, { signal })),
    );
    const mutation = runInInjectionContext(owner, () =>
      bindings.zmdbMutation((api, input: { readonly id: string; readonly name: string }, signal) =>
        api.renameWidget(input, { signal }),
      ),
    );
    const queryRequest = await transport.nextRequest();
    const mutationResult = mutation.mutate({ id: 'mutation', name: 'Mutation' });
    void mutationResult.catch(() => undefined);
    const mutationRequest = await transport.nextRequest();
    const observable = runInInjectionContext(owner, () =>
      bindings.zmdbObservable({ id: 'observable' }, (api, input, signal) => api.getWidget(input, { signal })),
    );
    let observableCompleted = false;
    let observableError: unknown;
    const subscription = observable.subscribe({
      error(error) {
        observableError = error;
      },
      complete() {
        observableCompleted = true;
      },
    });
    const observableRequest = await transport.nextRequest();

    owner.destroy();
    await flushAdapterCompletions();

    expect(queryRequest.state).toBe('aborted');
    expect(queryRequest.request.signal?.reason).toBe(queryRequest.abortReason);
    expect(mutationRequest.state).toBe('aborted');
    expect(mutationRequest.request.signal?.reason).toBe(mutationRequest.abortReason);
    expect(observableRequest.state).toBe('aborted');
    expect(observableRequest.request.signal?.reason).toBe(observableRequest.abortReason);
    await expect(mutationResult).rejects.toBe(mutationRequest.abortReason);
    expect(query.error()).toBeUndefined();
    expect(query.loading()).toBe(false);
    expect(mutation.error()).toBeUndefined();
    expect(mutation.pending()).toBe(false);
    expect(observableCompleted).toBe(true);
    expect(observableError).toBeUndefined();
    expect(subscription.closed).toBe(true);
    transport.assertIdle('Angular DestroyRef');
  });

  it('Observable unsubscribe aborts the transport', async () => {
    const { client, transport } = createAdapterClientFixture();
    const root = rootInjector('observable-root');
    const owner = childInjector(root, 'observable-owner', client);
    const observable = runInInjectionContext(owner, () =>
      bindings.zmdbObservable({ id: 'observable' }, (api, input, signal) => api.getWidget(input, { signal })),
    );
    const firstSubscription = observable.subscribe();
    const firstRequest = await transport.nextRequest();
    let secondValue: unknown;
    const secondSubscription = observable.subscribe(value => {
      secondValue = value;
    });
    const secondRequest = await transport.nextRequest();

    firstSubscription.unsubscribe();
    await flushAdapterCompletions();

    expect(firstRequest.state).toBe('aborted');
    expect(firstRequest.request.signal?.reason).toBe(firstRequest.abortReason);
    expect(secondRequest.state).toBe('pending');
    secondRequest.respondJson(200, { id: 'observable', name: 'Second subscription' });
    await flushAdapterCompletions();
    expect(secondValue).toEqual({ id: 'observable', name: 'Second subscription' });
    expect(secondRequest.state).toBe('responded');
    expect(secondSubscription.closed).toBe(true);
    transport.assertIdle('Angular Observable');
  });

  it('signal state updates through the Angular lifecycle', async () => {
    const { client, transport } = createAdapterClientFixture();
    const root = rootInjector('signal-root');
    const owner = childInjector(root, 'signal-owner', client);
    const query = runInInjectionContext(owner, () =>
      bindings.zmdbQuery({ id: 'first' }, (api, input, signal) => api.getWidget(input, { signal })),
    );

    expect(query.data()).toBeUndefined();
    expect(query.error()).toBeUndefined();
    expect(query.loading()).toBe(true);

    const first = await transport.nextRequest();
    first.respondJson(200, { id: 'first', name: 'First' });
    await flushAdapterCompletions();
    expect(query.data()).toEqual({ id: 'first', name: 'First' });
    expect(query.loading()).toBe(false);

    query.setInput({ id: 'second' });
    expect(query.data()).toBeUndefined();
    expect(query.loading()).toBe(true);
    const second = await transport.nextRequest();
    second.respondJson(200, { id: 'second', name: 'Second' });
    await flushAdapterCompletions();
    expect(query.data()).toEqual({ id: 'second', name: 'Second' });
    expect(query.error()).toBeUndefined();
    expect(query.loading()).toBe(false);
    transport.assertIdle('Angular signals');
  });

  it('SSR injectors do not share clients or credentials', async () => {
    await assertSsrCredentialIsolation(createAngularConformanceBinding<ApiClient>(angularExpectation()));
  });

  it('importing the package does not require HttpClient', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/angular/package.json'), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };
    expect(manifest.dependencies?.['@angular/common']).toBeUndefined();
    expect(manifest.peerDependencies?.['@angular/common']).toBeUndefined();
    expect(existsSync(join(ROOT, 'node_modules/@angular/common'))).toBe(false);
    assertAdapterImportsWithoutEffects(ROOT, angularExpectation());
  });
});
