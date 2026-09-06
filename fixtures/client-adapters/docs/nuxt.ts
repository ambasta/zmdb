import { createZmdbNuxt } from '@zmdb/nuxt/client';
import { createZmdbNuxtServerPlugin } from '@zmdb/nuxt/server';
import { useAsyncData } from 'nuxt/app';

import { createApiClient, type ApiClient } from './api.generated.js';

export const widgets = createZmdbNuxt<ApiClient>({ useAsyncData });
export const serverPlugin = createZmdbNuxtServerPlugin(widgets, createApiClient, {
  baseUrl: '/api',
  fetch: globalThis.fetch,
  forwardHeaders: ['authorization'],
  forwardCookies: ['session'],
});

export function useWidget(id: string) {
  return widgets.useZmdbAsyncData('get_widget', { id }, (api, input, signal) => api.getWidget(input, { signal }));
}
