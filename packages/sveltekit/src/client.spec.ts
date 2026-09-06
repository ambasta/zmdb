import { createQueryStore as createBaseQueryStore } from '@zmdb/svelte';
import { describe, expect, it } from 'vitest';

import { createApiClient, type Widget } from '../../../fixtures/client-adapters/src/index.js';
import {
  createQueryStore,
  createSvelteKitClientLoad,
  createSvelteKitNavigationScope,
  type SvelteKitClientLoadEvent,
} from './client.js';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  const result = Promise.withResolvers<Value>();
  return {
    promise: result.promise,
    resolve: result.resolve,
    reject: result.reject,
  };
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('@zmdb/sveltekit browser loads', () => {
  it('browser navigation uses browser fetch', async () => {
    const calls: string[] = [];
    const dependencies: string[] = [];
    const navigation = createSvelteKitNavigationScope();
    const event: SvelteKitClientLoadEvent = {
      depends: key => dependencies.push(key),
      fetch: async input => {
        calls.push(inputUrl(input));
        return Response.json({ id: 'one', name: 'Browser one' });
      },
    };
    const load = createSvelteKitClientLoad({
      key: 'widget:browser',
      navigation,
      createClient: createApiClient,
      clientOptions: { baseUrl: '/api' },
      load: (client, _event, signal) => client.getWidget({ id: 'one' }, { signal }),
    });

    await expect(load(event)).resolves.toEqual({ id: 'one', name: 'Browser one' });
    expect(calls).toEqual(['/api/widgets/one']);
    expect(dependencies).toEqual(['widget:browser']);
  });

  it('abandoned navigation aborts work', async () => {
    const navigation = createSvelteKitNavigationScope();
    const completion = deferred<void>();
    const signal = navigation.track({ complete: completion.promise });
    const started = Promise.withResolvers<void>();
    const event: SvelteKitClientLoadEvent = {
      depends: () => undefined,
      fetch: async (_input, init) => {
        started.resolve();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      },
    };
    const load = createSvelteKitClientLoad({
      key: 'widget:navigation',
      navigation,
      createClient: createApiClient,
      clientOptions: { baseUrl: '/api' },
      load: (client, _event, selectedSignal) => client.getWidget({ id: 'one' }, { signal: selectedSignal }),
    });
    const reason = Object.freeze({ kind: 'sveltekit-navigation-aborted' });

    const operation = load(event);
    await started.promise;
    completion.reject(reason);

    await expect(operation).rejects.toBe(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  it('successful navigation clears its selected signal without aborting it', async () => {
    const navigation = createSvelteKitNavigationScope();
    const completion = deferred<void>();
    const signal = navigation.track({ complete: completion.promise });

    expect(navigation.signal).toBe(signal);
    completion.resolve();
    await completion.promise;
    await Promise.resolve();
    expect(signal.aborted).toBe(false);
    expect(navigation.signal).toBeUndefined();
  });

  it('reuses @zmdb/svelte stores rather than copying them', () => {
    expect(createQueryStore).toBe(createBaseQueryStore);
  });

  it('preserves browser load error identity', async () => {
    const navigation = createSvelteKitNavigationScope();
    const error = Object.freeze({ kind: 'framework-status', status: 404 });
    const event: SvelteKitClientLoadEvent = {
      depends: () => undefined,
      fetch: async () => new Response(null, { status: 204 }),
    };
    const load = createSvelteKitClientLoad<object, SvelteKitClientLoadEvent, Widget>({
      key: 'widget:error',
      navigation,
      createClient: () => Object.freeze({}),
      clientOptions: { baseUrl: '/api' },
      load: () => Promise.reject(error),
    });

    await expect(load(event)).rejects.toBe(error);
  });
});
