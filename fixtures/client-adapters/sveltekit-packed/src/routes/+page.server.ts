import { createApiClient } from '$lib/api.generated.js';
import { error, redirect } from '@sveltejs/kit';
import { createSvelteKitServerLoad } from '@zmdb/sveltekit/server';

import type { PageServerLoad } from './$types.js';

export const load = createSvelteKitServerLoad({
  key: 'widget:ssr',
  createClient: createApiClient,
  clientOptions: {
    baseUrl: '/api',
    forward: {
      headers: ['x-tenant'],
      cookies: ['session'],
    },
  },
  load: async (client, event, signal) => {
    const mode = event.url.searchParams.get('mode');
    if (mode === 'redirect') redirect(307, '/redirected');
    if (mode === 'error') error(418, { message: 'short teapot' });

    const id = event.url.searchParams.get('id') ?? 'default';
    return {
      widget: await client.getWidget({ id }, { signal }),
    };
  },
}) satisfies PageServerLoad;
