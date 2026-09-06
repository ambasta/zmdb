import { createZmdbNuxt } from '@zmdb/nuxt/client';
import type { ZmdbNuxtAsyncData } from '@zmdb/nuxt/client';
import type { NuxtApp, useAsyncData as NuxtUseAsyncData } from 'nuxt/app';
import type { MaybeRefOrGetter } from 'vue';

import type { AdapterConformanceBinding } from './conformance.js';
import { createVueFamilyConformanceBinding } from './vue-binding.js';

function unusedAsyncData<Output>(
  _key: MaybeRefOrGetter<string>,
  _handler: (nuxtApp: NuxtApp, options: { signal: AbortSignal }) => Promise<Output>,
): ZmdbNuxtAsyncData<Output> {
  throw new Error('@zmdb/nuxt common conformance does not activate useAsyncData');
}

const useAsyncData = unusedAsyncData as unknown as typeof NuxtUseAsyncData;

export function createNuxtConformanceBinding<Client extends object>(): AdapterConformanceBinding<Client> {
  return createVueFamilyConformanceBinding('@zmdb/nuxt', () =>
    createZmdbNuxt<Client>({
      bindingName: '@zmdb/nuxt conformance',
      useAsyncData,
    }),
  );
}
