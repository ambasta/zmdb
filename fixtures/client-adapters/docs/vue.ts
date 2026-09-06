import { createZmdbVue } from '@zmdb/vue';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbVue<ApiClient>('Widgets');
export const plugin = widgets.createZmdbPlugin(client);

export function useWidget(id: string) {
  return widgets.useZmdbQuery({ id }, (api, input, signal) => api.getWidget(input, { signal }));
}

export function useRenameWidget() {
  return widgets.useZmdbMutation((api, input: { id: string; name: string }, signal) =>
    api.renameWidget(input, { signal }),
  );
}
