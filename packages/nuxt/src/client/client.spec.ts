import type { AsyncData, NuxtApp, NuxtError, useAsyncData as NuxtUseAsyncData } from 'nuxt/app';
import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, shallowRef, toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

import {
  createApiClient,
  type ApiClient,
  type GetWidgetInput,
  type Widget,
} from '../../../../fixtures/client-adapters/src/generated/api.generated.js';
import { createNuxtDataKey, createZmdbNuxt, createZmdbNuxtClientPlugin, type ZmdbNuxtAsyncData } from './index.js';

type NativeHandler<Output> = (nuxtApp: NuxtApp, options: { signal: AbortSignal }) => Promise<Output>;

function asyncDataState<Output>(value: Output | undefined): ZmdbNuxtAsyncData<Output> {
  const data = shallowRef(value);
  const error = shallowRef<NuxtError<unknown> | undefined>(undefined);
  const pending = shallowRef(false);
  const status = shallowRef<'idle' | 'pending' | 'success' | 'error'>(value === undefined ? 'idle' : 'success');
  const state = {
    data,
    error,
    pending,
    status,
    async refresh() {},
    async execute() {},
    clear() {
      data.value = undefined;
      error.value = undefined;
      pending.value = false;
      status.value = 'idle';
    },
  };
  return Object.assign(Promise.resolve(state), state) as unknown as ZmdbNuxtAsyncData<Output>;
}

function cachedAsyncData(payload: ReadonlyMap<string, unknown>, calls: string[]): typeof NuxtUseAsyncData {
  const useAsyncData = <Output>(
    key: MaybeRefOrGetter<string>,
    handler: NativeHandler<Output>,
  ): AsyncData<Output | undefined, NuxtError<unknown> | undefined> => {
    const selectedKey = toValue(key);
    calls.push(selectedKey);
    const cached = payload.get(selectedKey);
    if (cached !== undefined) {
      return asyncDataState(cached) as unknown as ZmdbNuxtAsyncData<Output>;
    }
    void handler;
    return asyncDataState<Output>(undefined);
  };
  return useAsyncData as unknown as typeof NuxtUseAsyncData;
}

describe('@zmdb/nuxt client bindings (#698)', () => {
  it('keys remain stable for the same operation and input', () => {
    expect(createNuxtDataKey('getWidget', { page: 2, filter: { active: true, role: 'admin' } })).toBe(
      createNuxtDataKey('getWidget', { filter: { role: 'admin', active: true }, page: 2 }),
    );
    expect(createNuxtDataKey('getWidget', { id: 'one' })).not.toBe(createNuxtDataKey('getWidget', { id: 'two' }));
    expect(createNuxtDataKey('getWidget', { id: 'one' })).not.toBe(createNuxtDataKey('renameWidget', { id: 'one' }));
  });

  it('rejects non-serializable hydration inputs before dispatch', () => {
    expect(() => createNuxtDataKey('getWidget', { value: Number.POSITIVE_INFINITY })).toThrow(
      'hydration input numbers must be finite',
    );
    expect(() => createNuxtDataKey('getWidget', { value: undefined })).toThrow(
      'hydration input contains non-serializable undefined',
    );
    expect(() => createNuxtDataKey('getWidget', new Date(0))).toThrow(
      'hydration input must contain only plain objects and arrays',
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => createNuxtDataKey('getWidget', cyclic)).toThrow('hydration input contains a cycle');
    const symbolKey = Symbol('hidden');
    expect(() => createNuxtDataKey('getWidget', { [symbolKey]: 'hidden' })).toThrow(
      'hydration input contains non-serializable symbol keys',
    );
    expect(() => createNuxtDataKey('getWidget', Array(1))).toThrow(
      'hydration input arrays must be dense and contain no named properties',
    );
  });

  it('hydration does not duplicate an already resolved request', () => {
    const input: GetWidgetInput = { id: 'hydrated' };
    const key = createNuxtDataKey('getWidget', input);
    const hydrated: Widget = { id: 'hydrated', name: 'Server payload' };
    const keys: string[] = [];
    const load = vi.fn((_client: ApiClient, _input: GetWidgetInput, _signal: AbortSignal) =>
      Promise.resolve<Widget>({ id: 'duplicate', name: 'Duplicate request' }),
    );
    const bindings = createZmdbNuxt<ApiClient>({
      useAsyncData: cachedAsyncData(new Map([[key, hydrated]]), keys),
    });
    const app = createSSRApp({ render: () => null });
    app.use(bindings.createZmdbPlugin(createApiClient({ baseUrl: '/api', transport: vi.fn() })));

    const result = app.runWithContext(() => bindings.useZmdbAsyncData('getWidget', input, load));

    expect(keys).toEqual([key]);
    expect(load).not.toHaveBeenCalled();
    expect(result.data.value).toEqual(hydrated);
  });

  it('client navigation uses the browser transport', async () => {
    const urls: string[] = [];
    const browserFetch: typeof globalThis.fetch = async input => {
      urls.push(input instanceof Request ? input.url : String(input));
      return new Response(JSON.stringify({ id: 'browser', name: 'Browser result' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const bindings = createZmdbNuxt<ApiClient>({
      useAsyncData: cachedAsyncData(new Map(), []),
    });
    const app = createSSRApp({ render: () => null });
    const plugin = createZmdbNuxtClientPlugin(bindings, createApiClient, {
      baseUrl: '/api',
      fetch: browserFetch,
    });

    plugin({ vueApp: app });
    const result = await app.runWithContext(() => bindings.useZmdbClient().getWidget({ id: 'browser' }));

    expect(result).toEqual({ id: 'browser', name: 'Browser result' });
    expect(urls).toEqual(['/api/widgets/browser']);
  });
});
