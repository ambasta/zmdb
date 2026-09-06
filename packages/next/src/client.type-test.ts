import { createZmdbNextClient } from '@zmdb/next/client';
import type { QueryState, ZmdbReactBindings } from '@zmdb/next/client';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface GeneratedClient {
  getWidget(input: { readonly id: string }, options: { readonly signal: AbortSignal }): Promise<Widget>;
}

const bindings = createZmdbNextClient<GeneratedClient>('NextWidgets');

function inference(next: ZmdbReactBindings<GeneratedClient>): void {
  const client = next.useZmdbClient();
  client.getWidget satisfies GeneratedClient['getWidget'];

  const query = next.useZmdbQuery((api, signal) => api.getWidget({ id: 'one' }, { signal }), ['one']);
  query satisfies QueryState<Widget>;
  query.data satisfies Widget | undefined;
}

bindings satisfies ZmdbReactBindings<GeneratedClient>;
void inference;
