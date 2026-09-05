# @zmdb/angular

`@zmdb/angular` binds an application-generated zmdb client to Angular dependency injection, signals, `DestroyRef`, and RxJS subscription cancellation. It adds no HTTP implementation, cache, retry
policy, or generated-client metadata layer.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/angular@alpha @angular/core@">=22.1.0 <23.0.0" rxjs@">=7.4.0 <8.0.0"
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**.

## Bind one generated client type

```ts
import type { ApiClient } from './generated/api.js';
import { createZmdbAngular } from '@zmdb/angular';

export const { ZMDB_CLIENT, provideZmdbClient, injectZmdbClient, zmdbQuery, zmdbMutation, zmdbObservable } = createZmdbAngular<ApiClient>('application API client');
```

Provide a client at the application or request-injector boundary:

```ts
bootstrapApplication(AppComponent, {
  providers: [provideZmdbClient(client)],
});
```

Child environment injectors inherit that client and may override it with another `provideZmdbClient` call. This is the SSR boundary: create one client and injector per request rather than storing a
current client or credentials in a module global. The token carries a frozen one-property holder because Angular probes provider values for `ngOnDestroy`; `injectZmdbClient()` returns the original
generated client by identity without exposing it to that framework probe.

## Signals and lifecycle cancellation

Create queries and mutations inside an Angular injection context:

```ts
const widget = zmdbQuery({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));

widget.data();
widget.loading();
widget.error();

widget.setInput({ id: 'two' }); // aborts the previous request
await widget.refresh();

const rename = zmdbMutation((client, input: RenameWidgetInput, signal) => client.renameWidget(input, { signal }));
await rename.mutate({ id: 'two', name: 'Renamed' });
```

Destroying the owning injector or component aborts every active request through its `DestroyRef`. Query state is generation-guarded, so a transport that ignores abort cannot publish a stale result.
Mutations remain independent because aborting an earlier non-idempotent request cannot prove the server did not execute it.

## Observable cancellation

`zmdbObservable` is cold and starts one generated-client request per subscription:

```ts
const widget$ = zmdbObservable({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));

const subscription = widget$.subscribe({
  next: widget => render(widget),
  error: error => report(error),
});

subscription.unsubscribe(); // aborts that subscription's exact request
```

No `HttpClient` dependency is required. If an application chooses Angular `HttpClient`, adapt it while constructing the generated client; this package consumes the resulting client structurally and
does not duplicate transport, authentication, URL, or response-validation logic. The application installs `@zmdb/client` for its generated client; `@zmdb/angular` itself keeps no workspace dependency
because it accepts that generated client's public method shape without importing its runtime.

## Documentation

See the [framework integration matrix](https://ambasta.github.io/zmdb/docs/framework-integrations.html) and the generated-client documentation.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
