import type { ClientResponseError } from '@zmdb/client';
import type { Readable } from 'svelte/store';
import { writable } from 'svelte/store';

import {
  createMutationStore,
  createQueryStore,
  createZmdbSvelte,
  type MutationSnapshot,
  type QuerySnapshot,
  type SvelteMutationStore,
  type SvelteQueryStore,
} from './index.js';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface GetWidgetInput {
  readonly id: string;
}

interface RenameWidgetInput {
  readonly id: string;
  readonly name: string;
}

interface ApiClient {
  getWidget(input: GetWidgetInput, options: { readonly signal: AbortSignal }): Promise<Widget>;
  renameWidget(input: RenameWidgetInput, options: { readonly signal: AbortSignal }): Promise<Widget>;
}

function inference(client: ApiClient): void {
  const bindings = createZmdbSvelte<ApiClient>();
  bindings.setClient satisfies (client: ApiClient) => ApiClient;
  bindings.getClient satisfies () => ApiClient;
  bindings.hasClient satisfies () => boolean;

  const staticQuery = bindings.query({ id: 'one' }, (api, input, signal) => api.getWidget(input, { signal }));
  staticQuery satisfies SvelteQueryStore<Widget>;
  staticQuery satisfies Readable<QuerySnapshot<Widget>>;

  const input = writable<GetWidgetInput>({ id: 'one' });
  const inputQuery = createQueryStore(client, input, (api, value, signal) => api.getWidget(value, { signal }));
  inputQuery.subscribe(snapshot => {
    snapshot.data satisfies Widget | undefined;
    snapshot.error satisfies unknown;
    snapshot.loading satisfies boolean;
  });

  const mutation = bindings.mutation((api, value: RenameWidgetInput, signal) => api.renameWidget(value, { signal }));
  mutation satisfies SvelteMutationStore<RenameWidgetInput, Widget>;
  mutation satisfies Readable<MutationSnapshot>;
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });

  const directMutation = createMutationStore(client, (api, value: RenameWidgetInput, signal) =>
    api.renameWidget(value, { signal }),
  );
  directMutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;

  staticQuery.subscribe(snapshot => {
    const possibleError: ClientResponseError<number, unknown> | unknown = snapshot.error;
    void possibleError;
  });
}

void inference;
