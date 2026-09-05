import { createZmdbVue } from '@zmdb/vue';
import type { VueMutationState, VueQueryState, ZmdbVueBindings } from '@zmdb/vue';
import { computed } from 'vue';
import type { Plugin, Ref } from 'vue';

import type {
  ApiClient,
  GetWidgetInput,
  RenameWidgetInput,
  Widget,
} from '../../../fixtures/client-adapters/src/generated/api.generated.js';

function inference(client: ApiClient): void {
  const bindings = createZmdbVue<ApiClient>();
  bindings satisfies ZmdbVueBindings<ApiClient>;
  bindings.createZmdbPlugin(client) satisfies Plugin;
  bindings.useZmdbClient satisfies () => ApiClient;

  const input = computed<GetWidgetInput>(() => ({ id: 'one' }));
  const query = bindings.useZmdbQuery(input, (api, selected, signal) => api.getWidget(selected, { signal }));
  query satisfies VueQueryState<Widget>;
  query.data satisfies Readonly<Ref<Widget | undefined>>;
  query.error.value satisfies unknown;
  query.loading.value satisfies boolean;
  query.refresh satisfies () => Promise<void>;

  const mutation = bindings.useZmdbMutation((api, selected: RenameWidgetInput, signal) =>
    api.renameWidget(selected, { signal }),
  );
  mutation satisfies VueMutationState<RenameWidgetInput, Widget>;
  mutation.pending.value satisfies boolean;
  mutation.mutate satisfies (input: RenameWidgetInput) => Promise<Widget>;
  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });
}

void inference;
