import { createZmdbNuxt, createZmdbNuxtClientPlugin } from '@zmdb/nuxt/client';
import type { ZmdbNuxtAsyncData } from '@zmdb/nuxt/client';
import type { NuxtApp, useAsyncData as NuxtUseAsyncData } from 'nuxt/app';
import { createSSRApp } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

import { createApiClient, type ApiClient } from './app/generated/api.generated.js';

function unusedAsyncData<Output>(
  _key: MaybeRefOrGetter<string>,
  _handler: (nuxtApp: NuxtApp, options: { signal: AbortSignal }) => Promise<Output>,
): ZmdbNuxtAsyncData<Output> {
  throw new Error('packed browser probe does not activate useAsyncData');
}

const useAsyncData = unusedAsyncData as unknown as typeof NuxtUseAsyncData;
const calls: string[] = [];
const fetch: typeof globalThis.fetch = async input => {
  calls.push(input instanceof Request ? input.url : String(input));
  return new Response(JSON.stringify({ id: 'navigation', name: 'Browser navigation' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
const bindings = createZmdbNuxt<ApiClient>({
  bindingName: '@zmdb/nuxt packed browser',
  useAsyncData,
});
const app = createSSRApp({ render: () => null });
createZmdbNuxtClientPlugin(bindings, createApiClient, {
  baseUrl: '/api',
  fetch,
})({ vueApp: app });

const result = await app.runWithContext(() => bindings.useZmdbClient().getWidget({ id: 'navigation' }));
process.stdout.write(
  JSON.stringify({
    calls,
    phase: 'client-navigation',
    result,
  }),
);
