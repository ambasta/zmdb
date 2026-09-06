import type { ClientOptions } from '@zmdb/client';
import { createNextServerClient } from '@zmdb/next/server';
import type {
  NextFetch,
  NextFetchCache,
  NextFetchPolicy,
  NextRequestSources,
  NextServerClient,
} from '@zmdb/next/server';

interface GeneratedClient {
  getWidget(input: { readonly id: string }): Promise<{ readonly id: string }>;
}

declare const fetch: typeof globalThis.fetch;
declare const request: NextRequestSources;

const nextFetch: NextFetch = fetch;
const cache: NextFetchCache = 'force-cache';
const policy = {
  cache,
  next: { revalidate: 60, tags: ['widgets'] },
} satisfies NextFetchPolicy;

const scope = createNextServerClient({
  createClient(_options: ClientOptions): GeneratedClient {
    return {
      getWidget(input) {
        return Promise.resolve(input);
      },
    };
  },
  baseUrl: 'https://api.example.test',
  fetch: nextFetch,
  request,
  forward: {
    headers: ['authorization'],
    cookies: ['session'],
  },
  fetchPolicy: policy,
});

async function inference(): Promise<void> {
  const selected = await scope;
  selected satisfies NextServerClient<GeneratedClient>;
  selected.client.getWidget satisfies GeneratedClient['getWidget'];

  const getWidget = selected.memoize(
    (client, id: string) => client.getWidget({ id }),
    id => id,
  );
  const widget = await getWidget('one');
  widget.id satisfies string;

  // @ts-expect-error generated input remains a string
  await getWidget(1);
}

void inference;
