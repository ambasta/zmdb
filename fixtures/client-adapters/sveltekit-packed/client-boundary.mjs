import {
  createMutationStore,
  createQueryStore,
  createSvelteKitBrowserClient,
  createSvelteKitClientLoad,
  createSvelteKitNavigationScope,
  createZmdbSvelte,
} from '@zmdb/sveltekit/client';

globalThis.__zmdbSvelteKitClient = [
  createMutationStore,
  createQueryStore,
  createSvelteKitBrowserClient,
  createSvelteKitClientLoad,
  createSvelteKitNavigationScope,
  createZmdbSvelte,
];
