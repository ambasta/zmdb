import type { ClientRuntime } from '@zmdb/client';
import {
  computed,
  getCurrentScope,
  hasInjectionContext,
  inject,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import type { App, InjectionKey, MaybeRefOrGetter, Plugin, Ref } from 'vue';

export type QueryLoader<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AbortSignal,
) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AbortSignal,
) => PromiseLike<Output>;

export interface VueQueryState<Output> {
  readonly data: Readonly<Ref<Output | undefined>>;
  readonly error: Readonly<Ref<unknown>>;
  readonly loading: Readonly<Ref<boolean>>;
  refresh(): Promise<void>;
}

export interface VueMutationState<Input, Output> {
  readonly error: Readonly<Ref<unknown>>;
  readonly pending: Readonly<Ref<boolean>>;
  mutate(input: Input): Promise<Output>;
}

export interface ZmdbVueBindings<Client extends object> {
  createZmdbPlugin(client: Client): Plugin;
  useZmdbClient(): Client;
  useZmdbQuery<Input, Output>(
    input: MaybeRefOrGetter<Input>,
    load: QueryLoader<Client, Input, Output>,
  ): VueQueryState<Output>;
  useZmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): VueMutationState<Input, Output>;
}

function invoke<Client, Input, Output>(
  operation: QueryLoader<Client, Input, Output> | MutationRunner<Client, Input, Output>,
  client: Client,
  input: Input,
  signal: AbortSignal,
): Promise<Output> {
  try {
    return Promise.resolve(operation(client, input, signal));
  } catch (error) {
    return Promise.reject(error);
  }
}

function cancellation(action: string): Error {
  const error = new Error(`@zmdb/vue ${action}`);
  error.name = 'ZmdbVueCancellation';
  return error;
}

function abort(controller: AbortController | undefined, reason: Error): void {
  if (controller !== undefined && !controller.signal.aborted) controller.abort(reason);
}

function requireScope(primitive: string): void {
  if (getCurrentScope() === undefined) {
    throw new Error(`@zmdb/vue ${primitive} requires an active Vue effect scope or component setup`);
  }
}

export function createZmdbVue<Client extends object = ClientRuntime>(
  bindingName = '@zmdb/vue',
): ZmdbVueBindings<Client> {
  const clientKey: InjectionKey<Client> = Symbol(`${bindingName} generated client`);

  function createZmdbPlugin(client: Client): Plugin {
    return Object.freeze({
      install(app: App): void {
        app.provide(clientKey, client);
      },
    });
  }

  function useZmdbClient(): Client {
    if (!hasInjectionContext()) {
      throw new Error(`${bindingName} client is unavailable; call useZmdbClient inside a Vue app or component setup`);
    }
    const client = inject(clientKey);
    if (client !== undefined) return client;
    throw new Error(`${bindingName} client is unavailable; install createZmdbPlugin(client) on the current Vue app`);
  }

  function useZmdbQuery<Input, Output>(
    input: MaybeRefOrGetter<Input>,
    load: QueryLoader<Client, Input, Output>,
  ): VueQueryState<Output> {
    requireScope('useZmdbQuery');
    const client = useZmdbClient();
    const data = shallowRef<Output | undefined>(undefined);
    const error = shallowRef<unknown>(undefined);
    const loading = shallowRef(false);
    let generation = 0;
    let active: AbortController | undefined;
    let disposed = false;
    let activated = false;

    const start = (selectedInput: Input, clearData: boolean): Promise<void> => {
      if (disposed) return Promise.reject(cancellation('query started after its scope was disposed'));

      generation += 1;
      const selectedGeneration = generation;
      const previous = active;
      const controller = new AbortController();
      active = controller;
      abort(previous, cancellation(clearData ? 'query input changed' : 'query was superseded'));
      if (clearData) data.value = undefined;
      error.value = undefined;
      loading.value = true;

      return invoke(load, client, selectedInput, controller.signal).then(
        value => {
          if (active === controller) active = undefined;
          if (!disposed && selectedGeneration === generation) {
            data.value = value;
            error.value = undefined;
            loading.value = false;
          }
        },
        failure => {
          if (active === controller) active = undefined;
          if (!disposed && selectedGeneration === generation && !controller.signal.aborted) {
            error.value = failure;
            loading.value = false;
          }
          throw failure;
        },
      );
    };

    const startSilently = (selectedInput: Input, clearData: boolean): void => {
      void start(selectedInput, clearData).catch(() => undefined);
    };

    const stop = watch(
      () => toValue(input),
      selectedInput => {
        const clearData = activated;
        activated = true;
        startSilently(selectedInput, clearData);
      },
      { flush: 'sync', immediate: true },
    );

    onScopeDispose(() => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      stop();
      const controller = active;
      active = undefined;
      abort(controller, cancellation('query scope was disposed'));
      loading.value = false;
    });

    return Object.freeze({
      data: computed(() => data.value),
      error: computed(() => error.value),
      loading: computed(() => loading.value),
      refresh(): Promise<void> {
        return start(toValue(input), false);
      },
    });
  }

  function useZmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): VueMutationState<Input, Output> {
    requireScope('useZmdbMutation');
    const client = useZmdbClient();
    const error = shallowRef<unknown>(undefined);
    const pending = shallowRef(false);
    const controllers = new Set<AbortController>();
    let inFlight = 0;
    let newest = 0;
    let disposed = false;

    onScopeDispose(() => {
      if (disposed) return;
      disposed = true;
      const reason = cancellation('mutation scope was disposed');
      for (const controller of controllers) abort(controller, reason);
      controllers.clear();
      inFlight = 0;
      pending.value = false;
    });

    return Object.freeze({
      error: computed(() => error.value),
      pending: computed(() => pending.value),
      mutate(input: Input): Promise<Output> {
        if (disposed) return Promise.reject(cancellation('mutation started after its scope was disposed'));

        newest += 1;
        const selectedGeneration = newest;
        const controller = new AbortController();
        controllers.add(controller);
        inFlight += 1;
        error.value = undefined;
        pending.value = true;

        const settle = (): void => {
          controllers.delete(controller);
          if (disposed) return;
          inFlight -= 1;
          pending.value = inFlight > 0;
        };

        return invoke(run, client, input, controller.signal).then(
          value => {
            settle();
            return value;
          },
          failure => {
            settle();
            if (!disposed && selectedGeneration === newest && !controller.signal.aborted) {
              error.value = failure;
            }
            throw failure;
          },
        );
      },
    });
  }

  return Object.freeze({
    createZmdbPlugin,
    useZmdbClient,
    useZmdbQuery,
    useZmdbMutation,
  });
}
