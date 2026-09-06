import { createMutationStore, createQueryStore } from '@zmdb/svelte';
import {
  createMutationStore as createSvelteKitMutationStore,
  createQueryStore as createSvelteKitQueryStore,
} from '@zmdb/sveltekit/client';
import { createSvelteKitServerClient, type SvelteKitRequestEvent } from '@zmdb/sveltekit/server';

import type { AdapterConformanceBinding, ApiClient, MutationRunner, QueryLoader } from './index.js';
import { ADAPTER_PACKAGES } from './package-matrix.js';
import { createSvelteAdapterConformanceBinding } from './svelte-binding.js';

function svelteKitExpectation() {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === '@zmdb/sveltekit');
  if (expectation === undefined) throw new Error('adapter matrix omitted @zmdb/sveltekit');
  return expectation;
}

function emptyCookies(): SvelteKitRequestEvent['cookies'] {
  return {
    get() {
      return undefined;
    },
    getAll() {
      return [];
    },
    set() {},
    delete() {},
    serialize(name, value) {
      return `${name}=${encodeURIComponent(value)}`;
    },
  };
}

async function runSsrQuery<Input, Output>(options: {
  readonly client: ApiClient;
  readonly input: Input;
  readonly load: QueryLoader<ApiClient, Input, Output>;
}): Promise<Output> {
  const event: SvelteKitRequestEvent = {
    cookies: emptyCookies(),
    request: new Request('http://fixture.test/ssr'),
    fetch: async () => {
      throw new Error('opaque conformance client unexpectedly used the SvelteKit event transport');
    },
  };
  const client = createSvelteKitServerClient(event, () => options.client, {
    baseUrl: '/api',
  });
  const controller = new AbortController();
  return Promise.resolve(options.load(client, options.input, controller.signal));
}

export function createSvelteKitAdapterConformanceBinding(): AdapterConformanceBinding<ApiClient> {
  if (!Object.is(createSvelteKitQueryStore, createQueryStore)) {
    throw new Error('@zmdb/sveltekit/client did not reuse @zmdb/svelte query stores');
  }
  if (!Object.is(createSvelteKitMutationStore, createMutationStore)) {
    throw new Error('@zmdb/sveltekit/client did not reuse @zmdb/svelte mutation stores');
  }

  const svelte = createSvelteAdapterConformanceBinding();
  return {
    package: svelteKitExpectation(),
    prepareQuery<Input, Output>(options: {
      readonly client: ApiClient;
      readonly input: Input;
      readonly load: QueryLoader<ApiClient, Input, Output>;
    }) {
      return svelte.prepareQuery(options);
    },
    prepareMutation<Input, Output>(options: {
      readonly client: ApiClient;
      readonly run: MutationRunner<ApiClient, Input, Output>;
    }) {
      return svelte.prepareMutation(options);
    },
    runSsrQuery,
  };
}
