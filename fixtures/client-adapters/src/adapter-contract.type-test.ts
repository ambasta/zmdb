// Compile-only framework inference freeze for #689.
//
// All nine official framework adapters now use their real public types. The
// empty retirement-trigger tuple below makes that completed state explicit.

import type { InjectionToken } from '@angular/core';
import { createZmdbAngular } from '@zmdb/angular';
import type { ZmdbAngularBindings, ZmdbClientRef } from '@zmdb/angular';
import { createZmdbNextClient } from '@zmdb/next/client';
import type { NextServerClient } from '@zmdb/next/server';
import nuxtModule from '@zmdb/nuxt';
import { createNuxtDataKey, createZmdbNuxt } from '@zmdb/nuxt/client';
import type { ZmdbNuxtAsyncData, ZmdbNuxtBindings } from '@zmdb/nuxt/client';
import { createNuxtServerTransport } from '@zmdb/nuxt/server';
import { createZmdbReact } from '@zmdb/react';
import type { ZmdbReactBindings } from '@zmdb/react';
import { createZmdbReactNative } from '@zmdb/react-native';
import type { ZmdbReactNativeBindings } from '@zmdb/react-native';
import { createZmdbSolid } from '@zmdb/solid';
import type { ZmdbSolidBindings } from '@zmdb/solid';
import { createMutationStore, createQueryStore, createZmdbSvelte } from '@zmdb/svelte';
import {
  createSvelteKitClientLoad,
  createSvelteKitNavigationScope,
  createZmdbSvelte as createZmdbSvelteKit,
  type SvelteKitClientLoadEvent,
} from '@zmdb/sveltekit/client';
import {
  createSvelteKitServerClient,
  createSvelteKitServerLoad,
  type SvelteKitServerLoadEvent,
} from '@zmdb/sveltekit/server';
import { createZmdbVue } from '@zmdb/vue';
import type { ZmdbVueBindings } from '@zmdb/vue';
import { useAsyncData } from 'nuxt/app';
import type { Observable } from 'rxjs';
import type { Readable } from 'svelte/store';

import {
  createApiClient,
  type AdapterConformanceBinding,
  type ApiClient,
  type GetWidgetInput,
  type MutationRunner,
  type MutationSnapshot,
  type QueryLoader,
  type QuerySnapshot,
  type RenameWidgetInput,
  type Widget,
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type ReactBindings<Client extends object> = ZmdbReactBindings<Client>;
type VueBindings<Client extends object> = ZmdbVueBindings<Client>;

interface SvelteQuery<Output> extends Readable<QuerySnapshot<Output>> {
  refresh(): Promise<void>;
}

interface SvelteMutation<Input, Output> extends Readable<MutationSnapshot> {
  mutate(input: Input): Promise<Output>;
}

interface SvelteBindings<Client> {
  query<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): SvelteQuery<Output>;
  mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): SvelteMutation<Input, Output>;
}

type SolidBindings<Client> = ZmdbSolidBindings<Client>;

function reactInference(bindings: ReactBindings<ApiClient>): void {
  const selectedClient = bindings.useZmdbClient();
  selectedClient.getWidget satisfies ApiClient['getWidget'];

  const query = bindings.useZmdbQuery((api, signal) => api.getWidget({ id: 'one' }, { signal }), ['one']);
  query.data satisfies Widget | undefined;
  query.error satisfies unknown;
  query.loading satisfies boolean;
  query.refresh satisfies () => Promise<void>;

  const mutation = bindings.useZmdbMutation((client, input: RenameWidgetInput, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
  mutation.pending satisfies boolean;
  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });
}

function nextInference(bindings: ReactBindings<ApiClient>, server: NextServerClient<ApiClient>): void {
  reactInference(bindings);
  server.client.getWidget satisfies ApiClient['getWidget'];
  const getWidget = server.memoize(
    (client, id: string) => client.getWidget({ id }),
    id => id,
  );
  getWidget satisfies (id: string) => Promise<Widget>;
}

function angularInference(bindings: ZmdbAngularBindings<ApiClient>): void {
  const query = bindings.zmdbQuery({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));
  query.data() satisfies Widget | undefined;
  query.error() satisfies unknown;
  query.loading() satisfies boolean;
  query.setInput satisfies (input: GetWidgetInput) => void;
  query.refresh satisfies () => Promise<void>;

  const mutation = bindings.zmdbMutation((client, input: RenameWidgetInput, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.pending() satisfies boolean;
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;

  const observable = bindings.zmdbObservable({ id: 'one' }, (client, input, signal) =>
    client.getWidget(input, { signal }),
  );
  observable satisfies Observable<Widget>;
  bindings.provideZmdbClient satisfies (client: ApiClient) => unknown;
  bindings.injectZmdbClient satisfies () => ApiClient;
  bindings.ZMDB_CLIENT satisfies InjectionToken<ZmdbClientRef<ApiClient>>;
}

function vueInference(bindings: VueBindings<ApiClient>): void {
  const selectedClient = bindings.useZmdbClient();
  selectedClient.getWidget satisfies ApiClient['getWidget'];

  const query = bindings.useZmdbQuery({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));
  query.data.value satisfies Widget | undefined;
  query.error.value satisfies unknown;
  query.loading.value satisfies boolean;
  query.refresh satisfies () => Promise<void>;

  const mutation = bindings.useZmdbMutation((client, input: RenameWidgetInput, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.pending.value satisfies boolean;
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
}

function nuxtInference(bindings: ZmdbNuxtBindings<ApiClient>): void {
  bindings.useZmdbClient().getWidget satisfies ApiClient['getWidget'];
  bindings.useZmdbQuery satisfies VueBindings<ApiClient>['useZmdbQuery'];
  bindings.useZmdbMutation satisfies VueBindings<ApiClient>['useZmdbMutation'];

  const data = bindings.useZmdbAsyncData('getWidget', { id: 'one' } satisfies GetWidgetInput, (client, input, signal) =>
    client.getWidget(input, { signal }),
  );
  data satisfies ZmdbNuxtAsyncData<Widget>;
  data.data.value satisfies Widget | undefined;
  data.pending.value satisfies boolean;
  createNuxtDataKey('getWidget', { id: 'one' }) satisfies string;
  createNuxtServerTransport(globalThis.fetch, new Headers()) satisfies ReturnType<typeof createNuxtServerTransport>;
}

function svelteInference(client: ApiClient): void {
  const bindings = createZmdbSvelte<ApiClient>();
  const query = bindings.query({ id: 'one' }, (api, input, signal) => api.getWidget(input, { signal }));
  query.subscribe(snapshot => {
    snapshot.data satisfies Widget | undefined;
    snapshot.error satisfies unknown;
    snapshot.loading satisfies boolean;
  });

  const mutation = bindings.mutation((api, input: RenameWidgetInput, signal) => api.renameWidget(input, { signal }));
  mutation.subscribe(snapshot => {
    snapshot.error satisfies unknown;
    snapshot.pending satisfies boolean;
  });
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;

  bindings.setClient satisfies (client: ApiClient) => ApiClient;
  bindings.getClient satisfies () => ApiClient;

  const directQuery = createQueryStore(client, { id: 'one' }, (api, input, signal) => api.getWidget(input, { signal }));
  directQuery satisfies SvelteQuery<Widget>;

  const directMutation = createMutationStore(client, (api, input: RenameWidgetInput, signal) =>
    api.renameWidget(input, { signal }),
  );
  directMutation satisfies SvelteMutation<RenameWidgetInput, Widget>;
  // @ts-expect-error generated mutation input still requires a name
  void directMutation.mutate({ id: 'one' });
}

function svelteKitInference(event: SvelteKitServerLoadEvent): void {
  const navigation = createSvelteKitNavigationScope();
  const bindings = createZmdbSvelteKit<ApiClient>();
  bindings satisfies SvelteBindings<ApiClient>;

  const serverClient = createSvelteKitServerClient(event, createApiClient, {
    baseUrl: '/api',
    forward: {
      headers: ['authorization'],
      cookies: ['session'],
    },
  });
  serverClient.getWidget satisfies ApiClient['getWidget'];

  const serverLoad = createSvelteKitServerLoad<ApiClient, SvelteKitServerLoadEvent, Widget>({
    key: 'widget:server',
    createClient: createApiClient,
    clientOptions: { baseUrl: '/api' },
    load: (client, loadEvent, signal) => {
      loadEvent.request satisfies Request;
      return client.getWidget({ id: 'one' }, { signal });
    },
  });
  serverLoad satisfies (loadEvent: SvelteKitServerLoadEvent) => Promise<Widget>;

  const clientLoad = createSvelteKitClientLoad<ApiClient, SvelteKitClientLoadEvent, Widget>({
    key: 'widget:client',
    navigation,
    createClient: createApiClient,
    clientOptions: { baseUrl: '/api' },
    load: (client, loadEvent, signal) => {
      loadEvent.fetch satisfies typeof globalThis.fetch;
      return client.getWidget({ id: 'one' }, { signal });
    },
  });
  clientLoad satisfies (loadEvent: SvelteKitClientLoadEvent) => Promise<Widget>;
}

function solidInference(bindings: SolidBindings<ApiClient>): void {
  const selectedClient = bindings.useClient();
  selectedClient.getWidget satisfies ApiClient['getWidget'];

  const query = bindings.query({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));
  query.data() satisfies Widget | undefined;
  query.latest() satisfies Widget | undefined;
  query.error() satisfies unknown;
  query.loading() satisfies boolean;

  const mutation = bindings.mutation((client, input: RenameWidgetInput, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.pending() satisfies boolean;
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
}

function conformanceBindingInference(binding: AdapterConformanceBinding<ApiClient>, client: ApiClient): void {
  const query = binding.prepareQuery({
    client,
    input: { id: 'one' },
    load: (api, input, signal) => api.getWidget(input, { signal }),
  });
  query.snapshot().data satisfies Widget | undefined;
  query.update satisfies (input: GetWidgetInput) => Promise<void>;
  query.refresh satisfies () => Promise<void>;
  query.dispose satisfies () => Promise<void>;

  const mutation = binding.prepareMutation({
    client,
    run: (api, input: RenameWidgetInput, signal) => api.renameWidget(input, { signal }),
  });
  mutation.snapshot().pending satisfies boolean;
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
  mutation.dispose satisfies () => Promise<void>;
}

type NativeBindingsByPackage = {
  readonly '@zmdb/react': ReactBindings<ApiClient>;
  readonly '@zmdb/angular': ZmdbAngularBindings<ApiClient>;
  readonly '@zmdb/vue': VueBindings<ApiClient>;
  readonly '@zmdb/svelte': SvelteBindings<ApiClient>;
  readonly '@zmdb/solid': SolidBindings<ApiClient>;
  readonly '@zmdb/react-native': ZmdbReactNativeBindings<ApiClient, string>;
  readonly '@zmdb/next': ReactBindings<ApiClient>;
  readonly '@zmdb/nuxt': ZmdbNuxtBindings<ApiClient>;
  readonly '@zmdb/sveltekit': SvelteBindings<ApiClient>;
};

export type _AllAdapterTypeBridges = Expect<
  Equal<
    keyof NativeBindingsByPackage,
    | '@zmdb/angular'
    | '@zmdb/next'
    | '@zmdb/nuxt'
    | '@zmdb/react'
    | '@zmdb/react-native'
    | '@zmdb/solid'
    | '@zmdb/svelte'
    | '@zmdb/sveltekit'
    | '@zmdb/vue'
  >
>;

export type _MetaFrameworksReuseNativeBaseShapes = [
  Expect<NativeBindingsByPackage['@zmdb/react-native'] extends NativeBindingsByPackage['@zmdb/react'] ? true : false>,
  Expect<Equal<NativeBindingsByPackage['@zmdb/next'], NativeBindingsByPackage['@zmdb/react']>>,
  Expect<NativeBindingsByPackage['@zmdb/nuxt'] extends NativeBindingsByPackage['@zmdb/vue'] ? true : false>,
  Expect<Equal<NativeBindingsByPackage['@zmdb/sveltekit'], NativeBindingsByPackage['@zmdb/svelte']>>,
];

export type _MissingPackageRetirementTriggers = [];

createZmdbReact<ApiClient>() satisfies ReactBindings<ApiClient>;
createZmdbReactNative<ApiClient, string>({
  appState: {
    currentState: 'active',
    addEventListener: () => ({ remove() {} }),
  },
  backgroundPolicy: 'abort',
  connectivity: {
    currentState: 'online',
    subscribe: () => () => undefined,
  },
  credentials: {
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  },
  offlinePolicy: 'refuse',
}) satisfies ZmdbReactNativeBindings<ApiClient, string>;
createZmdbVue<ApiClient>() satisfies VueBindings<ApiClient>;
createZmdbNextClient<ApiClient>() satisfies ReactBindings<ApiClient>;
createZmdbNuxt<ApiClient>({ useAsyncData }) satisfies ZmdbNuxtBindings<ApiClient>;
createZmdbSolid<ApiClient>() satisfies SolidBindings<ApiClient>;
nuxtModule satisfies object;
void reactInference;
void nextInference;
void angularInference;
void createZmdbAngular<ApiClient>;
void vueInference;
void nuxtInference;
void svelteInference;
void svelteKitInference;
void solidInference;
void conformanceBindingInference;
