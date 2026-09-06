import { createZmdbNuxt } from '@zmdb/nuxt/client';

import { useAsyncData } from '#app';

import { createApiClient } from './generated/api.generated.js';
import type { ApiClient } from './generated/api.generated.js';

export { createApiClient };
export const zmdb = createZmdbNuxt<ApiClient>({
  bindingName: '@zmdb/nuxt packed fixture',
  useAsyncData,
});
