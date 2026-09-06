import { createZmdbReact } from '@zmdb/react';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbReact<ApiClient>('Widgets');

export function useWidget(id: string) {
  return widgets.useZmdbQuery((api, signal) => api.getWidget({ id }, { signal }), [id]);
}

export function useRenameWidget() {
  return widgets.useZmdbMutation((api, input: { id: string; name: string }, signal) =>
    api.renameWidget(input, { signal }),
  );
}
