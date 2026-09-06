import nuxtModule from '@zmdb/nuxt';
import type { ZmdbNuxtModuleOptions } from '@zmdb/nuxt';
import { createNuxtDataKey, createZmdbNuxt, createZmdbNuxtClientPlugin } from '@zmdb/nuxt/client';
import type { NuxtGeneratedClientFactory, ZmdbNuxtAsyncData, ZmdbNuxtBindings } from '@zmdb/nuxt/client';
import { createNuxtServerTransport, createZmdbNuxtServerPlugin } from '@zmdb/nuxt/server';
import type { ZmdbNuxtServerPluginOptions } from '@zmdb/nuxt/server';
import { useAsyncData } from 'nuxt/app';
import type { NuxtModule } from 'nuxt/schema';
import { createSSRApp } from 'vue';

import {
  createApiClient,
  type ApiClient,
  type GetWidgetInput,
  type RenameWidgetInput,
  type Widget,
} from '../../../fixtures/client-adapters/src/generated/api.generated.js';

function inference(): void {
  nuxtModule satisfies NuxtModule<ZmdbNuxtModuleOptions>;
  createApiClient satisfies NuxtGeneratedClientFactory<ApiClient>;

  const bindings = createZmdbNuxt<ApiClient>({ useAsyncData });
  bindings satisfies ZmdbNuxtBindings<ApiClient>;
  bindings.useZmdbClient satisfies () => ApiClient;
  bindings.useZmdbQuery satisfies ZmdbNuxtBindings<ApiClient>['useZmdbQuery'];
  bindings.useZmdbMutation satisfies ZmdbNuxtBindings<ApiClient>['useZmdbMutation'];

  const data = bindings.useZmdbAsyncData('getWidget', { id: 'one' } satisfies GetWidgetInput, (client, input, signal) =>
    client.getWidget(input, { signal }),
  );
  data satisfies ZmdbNuxtAsyncData<Widget>;
  data.data.value satisfies Widget | undefined;
  data.pending.value satisfies boolean;

  const mutation = bindings.useZmdbMutation((client, input: RenameWidgetInput, signal) =>
    client.renameWidget(input, { signal }),
  );
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });

  const app = createSSRApp({ render: () => null });
  createZmdbNuxtClientPlugin(bindings, createApiClient, { baseUrl: '/api' })({ vueApp: app });

  const serverOptions: ZmdbNuxtServerPluginOptions = {
    baseUrl: '/api',
    fetch: globalThis.fetch,
    forwardHeaders: ['authorization'],
    forwardCookies: ['session'],
  };
  createZmdbNuxtServerPlugin(
    bindings,
    createApiClient,
    serverOptions,
  )({
    vueApp: app,
    ssrContext: { event: { headers: new Headers() } },
  });
  createNuxtServerTransport(globalThis.fetch, new Headers()) satisfies ReturnType<typeof createNuxtServerTransport>;
  createNuxtDataKey('getWidget', { id: 'one' }) satisfies string;
}

void inference;
