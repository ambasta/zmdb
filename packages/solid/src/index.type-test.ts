import { createSignal } from 'solid-js';

import { createZmdbSolid } from './index.js';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface GeneratedClient {
  getWidget(input: { readonly id: string }, options: { readonly signal: AbortSignal }): Promise<Widget>;
  renameWidget(
    input: { readonly id: string; readonly name: string },
    options: { readonly signal: AbortSignal },
  ): Promise<Widget>;
}

function generatedClientInference(): void {
  const bindings = createZmdbSolid<GeneratedClient>();
  const [id] = createSignal('one');
  const query = bindings.query(
    () => ({ id: id() }),
    (client, input, signal) => client.getWidget(input, { signal }),
  );
  query.data() satisfies Widget | undefined;
  query.latest() satisfies Widget | undefined;
  query.error() satisfies unknown;
  query.loading() satisfies boolean;

  const mutation = bindings.mutation((client, input: { readonly id: string; readonly name: string }, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.mutate satisfies (input: { readonly id: string; readonly name: string }) => Promise<Widget>;
  mutation.pending() satisfies boolean;
  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });
}

void generatedClientInference;
