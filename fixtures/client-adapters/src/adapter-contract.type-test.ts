// Compile-only framework inference freeze for #689.
//
// React and Angular now use their real public types. The remaining namespace imports are
// retirement triggers: each implementation issue makes its directive unused,
// at which point that package's native bridge below must be replaced by the
// real public types rather than leaving a structural stand-in behind.

import type { InjectionToken } from '@angular/core';
import { createZmdbAngular } from '@zmdb/angular';
import type { ZmdbAngularBindings, ZmdbClientRef } from '@zmdb/angular';
// @ts-expect-error #697 supplies the Next client entry
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #697
import type * as MissingNextClientAdapter from '@zmdb/next/client';
// @ts-expect-error #697 supplies the Next server entry
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #697
import type * as MissingNextServerAdapter from '@zmdb/next/server';
// @ts-expect-error #698 supplies the Nuxt root entry
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #698
import type * as MissingNuxtAdapter from '@zmdb/nuxt';
// @ts-expect-error #698 supplies the Nuxt client entry
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #698
import type * as MissingNuxtClientAdapter from '@zmdb/nuxt/client';
// @ts-expect-error #698 supplies the Nuxt server entry
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #698
import type * as MissingNuxtServerAdapter from '@zmdb/nuxt/server';
import { createZmdbReact } from '@zmdb/react';
import type { ZmdbReactBindings } from '@zmdb/react';
// @ts-expect-error #696 supplies the React Native adapter package
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #696
import type * as MissingReactNativeAdapter from '@zmdb/react-native';
// @ts-expect-error #695 supplies the Solid adapter package
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #695
import type * as MissingSolidAdapter from '@zmdb/solid';
// @ts-expect-error #694 supplies the Svelte adapter package
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #694
import type * as MissingSvelteAdapter from '@zmdb/svelte';
// @ts-expect-error #699 supplies the SvelteKit client entry
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #699
import type * as MissingSvelteKitClientAdapter from '@zmdb/sveltekit/client';
// @ts-expect-error #699 supplies the SvelteKit server entry
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #699
import type * as MissingSvelteKitServerAdapter from '@zmdb/sveltekit/server';
// @ts-expect-error #693 supplies the Vue adapter package
// oxlint-disable-next-line import/no-namespace -- no public member name exists before #693
import type * as MissingVueAdapter from '@zmdb/vue';
import type { Observable } from 'rxjs';
import type { Accessor } from 'solid-js';
import type { Readable } from 'svelte/store';
import type { Ref } from 'vue';

import type {
  AdapterConformanceBinding,
  ApiClient,
  GetWidgetInput,
  MutationRunner,
  MutationSnapshot,
  QueryLoader,
  QuerySnapshot,
  RenameWidgetInput,
  Widget,
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type ReactBindings<Client extends object> = ZmdbReactBindings<Client>;

interface VueQuery<Output> {
  readonly data: Readonly<Ref<Output | undefined>>;
  readonly error: Readonly<Ref<unknown>>;
  readonly loading: Readonly<Ref<boolean>>;
  refresh(): Promise<void>;
}

interface VueMutation<Input, Output> {
  readonly error: Readonly<Ref<unknown>>;
  readonly pending: Readonly<Ref<boolean>>;
  mutate(input: Input): Promise<Output>;
}

interface VueBindings<Client> {
  query<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): VueQuery<Output>;
  mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): VueMutation<Input, Output>;
}

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

interface SolidQuery<Output> {
  readonly data: Accessor<Output | undefined>;
  readonly error: Accessor<unknown>;
  readonly loading: Accessor<boolean>;
  refresh(): Promise<void>;
}

interface SolidMutation<Input, Output> {
  readonly error: Accessor<unknown>;
  readonly pending: Accessor<boolean>;
  mutate(input: Input): Promise<Output>;
}

interface SolidBindings<Client> {
  query<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): SolidQuery<Output>;
  mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): SolidMutation<Input, Output>;
}

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
  const query = bindings.query({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));
  query.data.value satisfies Widget | undefined;
  query.error.value satisfies unknown;
  query.loading.value satisfies boolean;

  const mutation = bindings.mutation((client, input: RenameWidgetInput, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.pending.value satisfies boolean;
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
}

function svelteInference(bindings: SvelteBindings<ApiClient>): void {
  const query = bindings.query({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));
  query.subscribe(snapshot => {
    snapshot.data satisfies Widget | undefined;
    snapshot.error satisfies unknown;
    snapshot.loading satisfies boolean;
  });

  const mutation = bindings.mutation((client, input: RenameWidgetInput, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.subscribe(snapshot => {
    snapshot.error satisfies unknown;
    snapshot.pending satisfies boolean;
  });
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
}

function solidInference(bindings: SolidBindings<ApiClient>): void {
  const query = bindings.query({ id: 'one' }, (client, input, signal) => client.getWidget(input, { signal }));
  query.data() satisfies Widget | undefined;
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
  readonly '@zmdb/react-native': ReactBindings<ApiClient>;
  readonly '@zmdb/next': ReactBindings<ApiClient>;
  readonly '@zmdb/nuxt': VueBindings<ApiClient>;
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
  Expect<Equal<NativeBindingsByPackage['@zmdb/react-native'], NativeBindingsByPackage['@zmdb/react']>>,
  Expect<Equal<NativeBindingsByPackage['@zmdb/next'], NativeBindingsByPackage['@zmdb/react']>>,
  Expect<Equal<NativeBindingsByPackage['@zmdb/nuxt'], NativeBindingsByPackage['@zmdb/vue']>>,
  Expect<Equal<NativeBindingsByPackage['@zmdb/sveltekit'], NativeBindingsByPackage['@zmdb/svelte']>>,
];

export type _MissingPackageRetirementTriggers = [
  keyof typeof MissingNextClientAdapter,
  keyof typeof MissingNextServerAdapter,
  keyof typeof MissingNuxtAdapter,
  keyof typeof MissingNuxtClientAdapter,
  keyof typeof MissingNuxtServerAdapter,
  keyof typeof MissingReactNativeAdapter,
  keyof typeof MissingSolidAdapter,
  keyof typeof MissingSvelteAdapter,
  keyof typeof MissingSvelteKitClientAdapter,
  keyof typeof MissingSvelteKitServerAdapter,
  keyof typeof MissingVueAdapter,
];

createZmdbReact<ApiClient>() satisfies ReactBindings<ApiClient>;
void reactInference;
void angularInference;
void createZmdbAngular<ApiClient>;
void vueInference;
void svelteInference;
void solidInference;
void conformanceBindingInference;
