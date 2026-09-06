import type { LoadEvent, OnNavigate } from '@sveltejs/kit';
import { createFetchTransport } from '@zmdb/client';

import { SvelteKitAdapterError } from './errors.js';
import type { GeneratedClientFactory, SvelteKitClientOptions } from './shared.js';

export { createMutationStore, createQueryStore, createZmdbSvelte } from '@zmdb/svelte';
export type {
  MutationRunner,
  MutationSnapshot,
  QueryLoader,
  QuerySnapshot,
  SvelteMutationStore,
  SvelteQueryStore,
  ZmdbSvelteBindings,
} from '@zmdb/svelte';
export { SvelteKitAdapterError } from './errors.js';
export type { GeneratedClientFactory, SvelteKitClientOptions } from './shared.js';

export type SvelteKitClientLoadEvent = Pick<LoadEvent, 'depends' | 'fetch'>;

export interface SvelteKitNavigationScope {
  readonly signal: AbortSignal | undefined;
  track(navigation: Pick<OnNavigate, 'complete'>): AbortSignal;
}

export interface SvelteKitClientLoadDefinition<Client, Event extends SvelteKitClientLoadEvent, Output> {
  readonly key: `${string}:${string}`;
  readonly navigation: SvelteKitNavigationScope;
  readonly createClient: GeneratedClientFactory<Client>;
  readonly clientOptions: SvelteKitClientOptions;
  readonly load: (client: Client, event: Event, signal: AbortSignal) => PromiseLike<Output>;
}

export function createSvelteKitBrowserClient<Client>(
  event: Pick<LoadEvent, 'fetch'>,
  createClient: GeneratedClientFactory<Client>,
  options: SvelteKitClientOptions,
): Client {
  return createClient({
    ...options,
    transport: createFetchTransport(event.fetch),
  });
}

export function createSvelteKitNavigationScope(): SvelteKitNavigationScope {
  let current: AbortController | undefined;

  const clear = (selected: AbortController): void => {
    if (Object.is(current, selected)) current = undefined;
  };

  const scope: SvelteKitNavigationScope = {
    get signal() {
      return current?.signal;
    },
    track(navigation: Pick<OnNavigate, 'complete'>) {
      const controller = new AbortController();
      current = controller;
      void navigation.complete.then(
        () => {
          clear(controller);
        },
        (reason: unknown) => {
          controller.abort(reason);
          clear(controller);
        },
      );
      return controller.signal;
    },
  };

  return Object.freeze(scope);
}

export function createSvelteKitClientLoad<Client, Event extends SvelteKitClientLoadEvent, Output>(
  definition: SvelteKitClientLoadDefinition<Client, Event, Output>,
): (event: Event) => Promise<Output> {
  if (!definition.key.includes(':')) {
    throw new SvelteKitAdapterError('@zmdb/sveltekit client load keys must contain a namespace prefix');
  }

  return async event => {
    event.depends(definition.key);
    const client = createSvelteKitBrowserClient(event, definition.createClient, definition.clientOptions);
    const signal = definition.navigation.signal ?? new AbortController().signal;
    return definition.load(client, event, signal);
  };
}
