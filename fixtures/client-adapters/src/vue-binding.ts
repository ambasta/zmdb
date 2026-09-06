import { createZmdbVue } from '@zmdb/vue';
import type { VueMutationState, VueQueryState, ZmdbVueBindings } from '@zmdb/vue';
import { createSSRApp, effectScope, shallowRef } from 'vue';
import type { EffectScope } from 'vue';

import type {
  AdapterConformanceBinding,
  ConformanceMutation,
  ConformanceQuery,
  MutationRunner,
  MutationSnapshot,
  QueryLoader,
  QuerySnapshot,
} from './conformance.js';
import { ADAPTER_PACKAGES } from './package-matrix.js';
import type { AdapterPackageExpectation } from './package-matrix.js';

function vueExpectation(name: '@zmdb/nuxt' | '@zmdb/vue'): AdapterPackageExpectation {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === name);
  if (expectation === undefined) throw new Error(`the adapter matrix omitted ${name}`);
  return expectation;
}

function scopeValue<Value>(value: Value | undefined, primitive: string): Value {
  if (value === undefined) throw new Error(`@zmdb/vue ${primitive} did not activate inside its effect scope`);
  return value;
}

function querySnapshot<Output>(state: VueQueryState<Output> | undefined): QuerySnapshot<Output> {
  return state === undefined
    ? { data: undefined, error: undefined, loading: false }
    : {
        data: state.data.value,
        error: state.error.value,
        loading: state.loading.value,
      };
}

function mutationSnapshot<Input, Output>(state: VueMutationState<Input, Output> | undefined): MutationSnapshot {
  return state === undefined
    ? { error: undefined, pending: false }
    : { error: state.error.value, pending: state.pending.value };
}

function prepareVueQuery<Client extends object, Input, Output>(
  createBindings: () => ZmdbVueBindings<Client>,
  client: Client,
  initialInput: Input,
  load: QueryLoader<Client, Input, Output>,
): ConformanceQuery<Input, Output> {
  const bindings = createBindings();
  const input = shallowRef<Input>(initialInput);
  const app = createSSRApp({ render: () => null });
  app.use(bindings.createZmdbPlugin(client));
  let scope: EffectScope | undefined;
  let state: VueQueryState<Output> | undefined;
  let latestSettlement = Promise.resolve();
  let disposed = false;

  return {
    snapshot() {
      return querySnapshot(state);
    },
    async mount() {
      if (scope !== undefined) throw new Error('@zmdb/vue conformance query mounted twice');
      const selectedScope = effectScope();
      scope = selectedScope;
      state = app.runWithContext(() =>
        selectedScope.run(() =>
          bindings.useZmdbQuery(input, (selectedClient, selectedInput, signal) => {
            const operation = Promise.resolve(load(selectedClient, selectedInput, signal));
            latestSettlement = operation.then(
              () => undefined,
              () => undefined,
            );
            return operation;
          }),
        ),
      );
      scopeValue(state, 'query');
    },
    async update(nextInput) {
      if (scope === undefined || disposed) throw new Error('@zmdb/vue conformance query is not mounted');
      input.value = nextInput;
    },
    refresh() {
      return scopeValue(state, 'query').refresh();
    },
    whenSettled() {
      return latestSettlement;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      scope?.stop();
      await latestSettlement;
    },
  };
}

function prepareVueMutation<Client extends object, Input, Output>(
  createBindings: () => ZmdbVueBindings<Client>,
  client: Client,
  run: MutationRunner<Client, Input, Output>,
): ConformanceMutation<Input, Output> {
  const bindings = createBindings();
  const app = createSSRApp({ render: () => null });
  app.use(bindings.createZmdbPlugin(client));
  let scope: EffectScope | undefined;
  let state: VueMutationState<Input, Output> | undefined;
  let disposed = false;

  return {
    snapshot() {
      return mutationSnapshot(state);
    },
    async mount() {
      if (scope !== undefined) throw new Error('@zmdb/vue conformance mutation mounted twice');
      const selectedScope = effectScope();
      scope = selectedScope;
      state = app.runWithContext(() => selectedScope.run(() => bindings.useZmdbMutation(run)));
      scopeValue(state, 'mutation');
    },
    mutate(input) {
      return scopeValue(state, 'mutation').mutate(input);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      scope?.stop();
    },
  };
}

export function createVueFamilyConformanceBinding<Client extends object>(
  packageName: '@zmdb/nuxt' | '@zmdb/vue',
  createBindings: () => ZmdbVueBindings<Client>,
): AdapterConformanceBinding<Client> {
  return {
    package: vueExpectation(packageName),
    prepareQuery(options) {
      return prepareVueQuery(createBindings, options.client, options.input, options.load);
    },
    prepareMutation(options) {
      return prepareVueMutation(createBindings, options.client, options.run);
    },
    runSsrQuery(options) {
      const bindings = createBindings();
      const app = createSSRApp({ render: () => null });
      app.use(bindings.createZmdbPlugin(options.client));
      return app.runWithContext(() =>
        Promise.resolve(options.load(bindings.useZmdbClient(), options.input, new AbortController().signal)),
      );
    },
  };
}

export function createVueConformanceBinding<Client extends object>(): AdapterConformanceBinding<Client> {
  return createVueFamilyConformanceBinding('@zmdb/vue', () => createZmdbVue<Client>('@zmdb/vue conformance'));
}
