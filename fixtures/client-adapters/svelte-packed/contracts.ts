import { createMutationStore, createQueryStore, createZmdbSvelte, type QuerySnapshot } from '@zmdb/svelte';
import type { Readable } from 'svelte/store';
import { writable } from 'svelte/store';

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

function publicInference(client: ApiClient): void {
  const bindings = createZmdbSvelte<ApiClient>();
  const input = writable({ id: 'one' });
  const query = createQueryStore(client, input, (api, value, signal) => api.getWidget(value, { signal }));
  query satisfies Readable<QuerySnapshot<Widget>>;

  const contextual = bindings.query({ id: 'one' }, (api, value, signal) => api.getWidget(value, { signal }));
  contextual.subscribe(snapshot => {
    snapshot.data satisfies Widget | undefined;
  });

  const mutation = createMutationStore(client, (api, value: { readonly id: string; readonly name: string }, signal) =>
    api.renameWidget(value, { signal }),
  );
  mutation.mutate satisfies (input: { readonly id: string; readonly name: string }) => Promise<Widget>;
  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });
}

void publicInference;
