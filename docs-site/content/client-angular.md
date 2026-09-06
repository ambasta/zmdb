Start with the [generated HTTP client](./generated-client.html), then add Angular for injector ownership, signals, `DestroyRef`, and RxJS cancellation. The generated module and `@zmdb/client` own URL
construction, authentication patches, transport, response validation, and stable errors; `@zmdb/angular` owns only Angular lifecycle integration.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/angular@alpha @angular/core@">=22.1.0 <23.0.0" rxjs@">=7.4.0 <8.0.0"
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/angular.ts
import { createZmdbAngular } from '@zmdb/angular';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbAngular<ApiClient>('Widgets');
export const providers = widgets.provideZmdbClient(client);

export function widgetQuery(id: string) {
  return widgets.zmdbQuery({ id }, (api, input, signal) => api.getWidget(input, { signal }));
}

export function renameWidget() {
  return widgets.zmdbMutation((api, input: { id: string; name: string }, signal) => api.renameWidget(input, { signal }));
}
```

Add `providers` to the owning environment injector; child injectors may override it.

## Query

`zmdbQuery` exposes Angular signal state and starts under the current injection context.

## Mutate

`zmdbMutation` exposes pending/error signals and typed `mutate`.

## Cancellation

`DestroyRef` aborts owned work. `zmdbObservable` also aborts on final unsubscribe.

## Errors

Generated client errors retain their type, body, status, headers, and identity.

## SSR

Create an environment injector and generated client per request; never put credentials in a platform singleton.

## Testing

Use Angular's test injector with a generated client backed by a deterministic transport, then destroy the injector.
