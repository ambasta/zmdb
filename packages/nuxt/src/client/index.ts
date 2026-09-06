import { createFetchTransport } from '@zmdb/client';
import type { ClientOptions } from '@zmdb/client';
import type { FetchLike } from '@zmdb/client/transport';
import { createZmdbVue } from '@zmdb/vue';
import type { QueryLoader, ZmdbVueBindings } from '@zmdb/vue';
import type { AsyncData, NuxtError, useAsyncData as useNuxtAsyncData } from 'nuxt/app';
import { computed, toValue } from 'vue';
import type { App, MaybeRefOrGetter } from 'vue';

export type NuxtGeneratedClientFactory<Client extends object> = (options: ClientOptions) => Client;

export interface ZmdbNuxtBindingOptions {
  readonly useAsyncData: typeof useNuxtAsyncData;
  readonly bindingName?: string;
}

export interface ZmdbNuxtAsyncData<Output> extends AsyncData<Output | undefined, NuxtError<unknown> | undefined> {}

export interface ZmdbNuxtBindings<Client extends object> extends ZmdbVueBindings<Client> {
  useZmdbAsyncData<Input, Output>(
    operationKey: string,
    input: MaybeRefOrGetter<Input>,
    load: QueryLoader<Client, Input, Output>,
  ): ZmdbNuxtAsyncData<Output>;
}

export interface NuxtClientApplication {
  readonly vueApp: Pick<App, 'use'>;
}

export interface ZmdbNuxtClientPluginOptions {
  readonly baseUrl: string | URL;
  readonly fetch?: FetchLike;
}

function encoded(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error('@zmdb/nuxt could not serialize a hydration input');
    return result;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('@zmdb/nuxt hydration input numbers must be finite');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value !== 'object') {
    throw new Error(`@zmdb/nuxt hydration input contains non-serializable ${typeof value}`);
  }
  if (seen.has(value)) throw new Error('@zmdb/nuxt hydration input contains a cycle');

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new Error('@zmdb/nuxt hydration input arrays must be dense and contain no named properties');
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new Error('@zmdb/nuxt hydration input contains non-serializable symbol keys');
      }
      return `[${value.map(item => encoded(item, seen)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('@zmdb/nuxt hydration input must contain only plain objects and arrays');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error('@zmdb/nuxt hydration input contains non-serializable symbol keys');
    }
    const entries = Object.entries(value).toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, item]) => {
        const encodedKey = JSON.stringify(key);
        if (encodedKey === undefined) throw new Error('@zmdb/nuxt could not serialize a hydration key');
        return `${encodedKey}:${encoded(item, seen)}`;
      })
      .join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function createNuxtDataKey(operationKey: string, input: unknown): string {
  const selectedOperation = operationKey.trim();
  if (selectedOperation.length === 0) {
    throw new Error('@zmdb/nuxt operation key must be a non-empty string');
  }
  return `zmdb:${encoded([selectedOperation, input], new Set())}`;
}

function invoke<Client, Input, Output>(
  load: QueryLoader<Client, Input, Output>,
  client: Client,
  input: Input,
  signal: AbortSignal,
): Promise<Output> {
  try {
    return Promise.resolve(load(client, input, signal));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createZmdbNuxt<Client extends object>(options: ZmdbNuxtBindingOptions): ZmdbNuxtBindings<Client> {
  const vue = createZmdbVue<Client>(options.bindingName ?? '@zmdb/nuxt');

  return Object.freeze({
    ...vue,
    useZmdbAsyncData<Input, Output>(
      operationKey: string,
      input: MaybeRefOrGetter<Input>,
      load: QueryLoader<Client, Input, Output>,
    ): ZmdbNuxtAsyncData<Output> {
      const client = vue.useZmdbClient();
      const key = computed(() => createNuxtDataKey(operationKey, toValue(input)));
      return options.useAsyncData<Output, unknown, Output, never[], undefined>(
        key,
        (_nuxtApp, context) => invoke(load, client, toValue(input), context.signal),
        {
          dedupe: 'cancel',
          deep: false,
        },
      );
    },
  });
}

export function createZmdbNuxtClientPlugin<Client extends object>(
  bindings: Pick<ZmdbNuxtBindings<Client>, 'createZmdbPlugin'>,
  createClient: NuxtGeneratedClientFactory<Client>,
  options: ZmdbNuxtClientPluginOptions,
): (nuxtApp: NuxtClientApplication) => void {
  return nuxtApp => {
    const transport = createFetchTransport(options.fetch);
    const client = createClient({
      baseUrl: options.baseUrl,
      transport,
    });
    nuxtApp.vueApp.use(bindings.createZmdbPlugin(client));
  };
}
