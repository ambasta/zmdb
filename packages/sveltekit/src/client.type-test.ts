import type { LoadEvent, OnNavigate } from '@sveltejs/kit';
import type { ClientOptions } from '@zmdb/client';
import type { Readable } from 'svelte/store';

import {
  createMutationStore,
  createQueryStore,
  createSvelteKitBrowserClient,
  createSvelteKitClientLoad,
  createSvelteKitNavigationScope,
  createZmdbSvelte,
  type QuerySnapshot,
  type SvelteKitClientLoadEvent,
} from './client.js';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface ApiClient {
  getWidget(input: { readonly id: string }, options: { readonly signal: AbortSignal }): Promise<Widget>;
  renameWidget(
    input: { readonly id: string; readonly name: string },
    options: { readonly signal: AbortSignal },
  ): Promise<Widget>;
}

const createClient = (_options: ClientOptions): ApiClient => {
  throw new Error('compile-only client factory');
};

function inference(event: LoadEvent, navigationEvent: OnNavigate): void {
  const navigation = createSvelteKitNavigationScope();
  navigation.track(navigationEvent) satisfies AbortSignal;

  const client = createSvelteKitBrowserClient(event, createClient, { baseUrl: '/api' });
  client.getWidget satisfies ApiClient['getWidget'];

  const load = createSvelteKitClientLoad<ApiClient, LoadEvent, { readonly widget: Widget }>({
    key: 'widget:current',
    navigation,
    createClient,
    clientOptions: { baseUrl: '/api' },
    load: async (api, loadEvent, signal) => {
      loadEvent.fetch satisfies typeof globalThis.fetch;
      return {
        widget: await api.getWidget({ id: 'one' }, { signal }),
      };
    },
  });
  load satisfies (event: LoadEvent) => Promise<{ readonly widget: Widget }>;

  const bindings = createZmdbSvelte<ApiClient>();
  const query = createQueryStore(client, { id: 'one' }, (api, input, signal) => api.getWidget(input, { signal }));
  query satisfies Readable<QuerySnapshot<Widget>>;
  bindings.query({ id: 'one' }, (api, input, signal) => api.getWidget(input, { signal })) satisfies Readable<
    QuerySnapshot<Widget>
  >;

  const mutation = createMutationStore(client, (api, input: { readonly id: string; readonly name: string }, signal) =>
    api.renameWidget(input, { signal }),
  );
  mutation.mutate satisfies (input: { readonly id: string; readonly name: string }) => Promise<Widget>;
  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });
}

function minimalEvent(event: SvelteKitClientLoadEvent): void {
  event.fetch satisfies typeof globalThis.fetch;
  event.depends satisfies (...dependencies: `${string}:${string}`[]) => void;
}

void inference;
void minimalEvent;
