// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createContext, onDestroy } from 'svelte';
import type { Readable } from 'svelte/store';

import { createMutationStore } from './mutation.js';
import { createQueryStore } from './query.js';
import type {
  MutationRunner,
  QueryLoader,
  SvelteMutationStore,
  SvelteQueryStore,
  ZmdbSvelteBindings,
} from './types.js';

export function createZmdbSvelte<Client>(): ZmdbSvelteBindings<Client> {
  const [getClient, setClient, hasClient] = createContext<Client>();

  return Object.freeze({
    getClient,
    setClient,
    hasClient,
    query<Input, Output>(
      input: Input | Readable<Input>,
      load: QueryLoader<Client, Input, Output>,
    ): SvelteQueryStore<Output> {
      const store = createQueryStore(getClient(), input, load);
      onDestroy(store.destroy);
      return store;
    },
    mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): SvelteMutationStore<Input, Output> {
      const store = createMutationStore(getClient(), run);
      onDestroy(store.destroy);
      return store;
    },
  });
}
