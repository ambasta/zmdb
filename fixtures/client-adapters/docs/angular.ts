import { createZmdbAngular } from '@zmdb/angular';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbAngular<ApiClient>('Widgets');
export const providers = widgets.provideZmdbClient(client);

export function widgetQuery(id: string) {
  return widgets.zmdbQuery({ id }, (api, input, signal) => api.getWidget(input, { signal }));
}

export function renameWidget() {
  return widgets.zmdbMutation((api, input: { id: string; name: string }, signal) =>
    api.renameWidget(input, { signal }),
  );
}
