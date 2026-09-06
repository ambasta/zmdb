'use client';

import { createApiClient } from '@fixture/lib/api.generated';
import type { ApiClient } from '@fixture/lib/api.generated';
import { createZmdbNextClient } from '@zmdb/next/client';
import { useMemo } from 'react';

const bindings = createZmdbNextClient<ApiClient>('NextFixture');

function ClientStatus() {
  const client = bindings.useZmdbClient();
  return <span id="client-ready">{typeof client.getWidget === 'function' ? 'client-ready' : 'client-missing'}</span>;
}

export function ClientProbe() {
  const client = useMemo(() => createApiClient({ baseUrl: '/api/upstream' }), []);
  return (
    <bindings.ZmdbClientProvider client={client}>
      <ClientStatus />
    </bindings.ZmdbClientProvider>
  );
}
