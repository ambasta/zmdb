import type { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';

import { createZmdbAngular } from './index.js';
import type { ZmdbAngularBindings, ZmdbClientRef } from './index.js';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface GetWidgetInput {
  readonly id: string;
}

interface RenameWidgetInput {
  readonly id: string;
  readonly name: string;
}

interface GeneratedClient {
  getWidget(input: GetWidgetInput, options: { readonly signal: AbortSignal }): Promise<Widget>;
  renameWidget(input: RenameWidgetInput, options: { readonly signal: AbortSignal }): Promise<Widget>;
}

const bindings = createZmdbAngular<GeneratedClient>();
bindings satisfies ZmdbAngularBindings<GeneratedClient>;

const query = bindings.zmdbQuery({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));
query.data() satisfies Widget | undefined;
query.error() satisfies unknown;
query.loading() satisfies boolean;
query.setInput satisfies (input: GetWidgetInput) => void;
query.refresh satisfies () => Promise<void>;

const mutation = bindings.zmdbMutation((client, input: RenameWidgetInput, signal) =>
  client.renameWidget(input, { signal }),
);
mutation.error() satisfies unknown;
mutation.pending() satisfies boolean;
mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;

const observable = bindings.zmdbObservable({ id: 'one' }, (client, input, signal) =>
  client.getWidget(input, { signal }),
);
observable satisfies Observable<Widget>;

bindings.provideZmdbClient satisfies (client: GeneratedClient) => unknown;
bindings.injectZmdbClient satisfies () => GeneratedClient;
bindings.ZMDB_CLIENT satisfies InjectionToken<ZmdbClientRef<GeneratedClient>>;

// @ts-expect-error generated query input still requires the id
query.setInput({});
// @ts-expect-error generated mutation input still requires the name
void mutation.mutate({ id: 'one' });
// @ts-expect-error a binding for one generated client cannot accept another shape
bindings.provideZmdbClient({ getWidget: () => Promise.resolve({ id: 'one', name: 'One' }) });
