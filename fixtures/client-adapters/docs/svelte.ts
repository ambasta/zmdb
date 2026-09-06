import { createZmdbSvelte } from '@zmdb/svelte';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbSvelte<ApiClient>();

export function provideWidgets(): ApiClient {
  return widgets.setClient(client);
}

export function widgetQuery(id: string) {
  return widgets.query({ id }, (api, input, signal) => api.getWidget(input, { signal }));
}

export function renameWidget() {
  return widgets.mutation((api, input: { id: string; name: string }, signal) => api.renameWidget(input, { signal }));
}
