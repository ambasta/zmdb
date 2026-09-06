import { createSvelteKitClientLoad, createSvelteKitNavigationScope } from '@zmdb/sveltekit/client';
import { createSvelteKitServerLoad } from '@zmdb/sveltekit/server';

import { createApiClient } from './api.generated.js';

export const navigation = createSvelteKitNavigationScope();
export const browserWidget = createSvelteKitClientLoad({
  key: 'widgets:get',
  navigation,
  createClient: createApiClient,
  clientOptions: { baseUrl: '/api' },
  load: (client, _event, signal) => client.getWidget({ id: 'browser' }, { signal }),
});

export const serverWidget = createSvelteKitServerLoad({
  key: 'widgets:get',
  createClient: createApiClient,
  clientOptions: {
    baseUrl: '/api',
    forward: { headers: ['authorization'], cookies: ['session'] },
  },
  load: (client, _event, signal) => client.getWidget({ id: 'server' }, { signal }),
});
