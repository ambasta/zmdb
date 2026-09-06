import type { ServerLoad, ServerLoadEvent } from '@sveltejs/kit';
import type { ClientOptions } from '@zmdb/client';

import { createSvelteKitServerClient, createSvelteKitServerFetch, createSvelteKitServerLoad } from './server.js';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface ApiClient {
  getWidget(input: { readonly id: string }, options: { readonly signal: AbortSignal }): Promise<Widget>;
}

const createClient = (_options: ClientOptions): ApiClient => {
  throw new Error('compile-only client factory');
};

function inference(event: ServerLoadEvent): void {
  createSvelteKitServerFetch(event, {
    headers: ['authorization'],
    cookies: ['session'],
  }) satisfies typeof globalThis.fetch;

  const client = createSvelteKitServerClient(event, createClient, {
    baseUrl: '/api',
    forward: {
      headers: ['authorization'],
      cookies: ['session'],
    },
  });
  client.getWidget satisfies ApiClient['getWidget'];

  const load = createSvelteKitServerLoad<ApiClient, ServerLoadEvent, { readonly widget: Widget }>({
    key: 'widget:current',
    createClient,
    clientOptions: {
      baseUrl: '/api',
      forward: {
        headers: ['authorization'],
        cookies: ['session'],
      },
    },
    load: async (api, loadEvent, signal) => {
      loadEvent.request satisfies Request;
      return {
        widget: await api.getWidget({ id: 'one' }, { signal }),
      };
    },
  });
  load satisfies ServerLoad<Record<string, string>, Record<string, unknown>, { readonly widget: Widget }>;
}

void inference;
