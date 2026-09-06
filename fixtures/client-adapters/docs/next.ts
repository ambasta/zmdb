import { createZmdbNextClient } from '@zmdb/next/client';
import { createNextServerClient, type NextRequestSources } from '@zmdb/next/server';

import { createApiClient, type ApiClient } from './api.generated.js';

export const browserWidgets = createZmdbNextClient<ApiClient>('Widgets');

export async function serverWidget(request: NextRequestSources, id: string) {
  const scope = await createNextServerClient({
    createClient: createApiClient,
    baseUrl: 'https://api.example.com',
    fetch: globalThis.fetch,
    request,
    forward: { headers: ['authorization'], cookies: ['session'] },
    fetchPolicy: { cache: 'no-store' },
  });
  return scope.client.getWidget({ id });
}
