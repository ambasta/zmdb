import type { CallOptions } from '@zmdb/client';
import {
  createComponent,
  createContext,
  createMemo,
  createResource,
  createSignal,
  getOwner,
  onCleanup,
  useContext,
} from 'solid-js';
import type { Accessor, FlowComponent, Resource } from 'solid-js';

export type AdapterSignal = Exclude<CallOptions['signal'], undefined>;

export type QueryLoader<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AdapterSignal,
) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AdapterSignal,
) => PromiseLike<Output>;

export type SolidQuerySource<Input> = Input | Accessor<Input>;

export interface SolidQuery<Output> {
  /** Native Solid resource: reads participate in Suspense and throw the original error. */
  readonly data: Resource<Output | undefined>;
  /** Last successful value without reading through an errored resource. */
  readonly latest: Accessor<Output | undefined>;
  readonly error: Accessor<unknown>;
  readonly loading: Accessor<boolean>;
  /** Exact loader result currently owned by the resource. */
  readonly pending: Accessor<PromiseLike<Output> | undefined>;
  refresh(): Promise<void>;
}

export interface SolidMutation<Input, Output> {
  readonly error: Accessor<unknown>;
  readonly pending: Accessor<boolean>;
  mutate(input: Input): Promise<Output>;
}

export interface ZmdbSolidBindings<Client> {
  readonly Provider: FlowComponent<{ readonly client: Client }>;
  useClient(): Client;
  query<Input, Output>(source: SolidQuerySource<Input>, load: QueryLoader<Client, Input, Output>): SolidQuery<Output>;
  mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): SolidMutation<Input, Output>;
}

function requireOwner(primitive: string): void {
  if (getOwner() === null) {
    throw new Error(`@zmdb/solid ${primitive} must be created under a Solid owner`);
  }
}

function sourceAccessor<Input>(source: SolidQuerySource<Input>): Accessor<Input> {
  if (typeof source === 'function') return () => Reflect.apply(source, undefined, []);
  return () => source;
}

function promiseForSolid<Value>(operation: PromiseLike<Value>): Promise<Value> {
  return operation instanceof Promise ? operation : Promise.resolve(operation);
}

export function createZmdbSolid<Client>(): ZmdbSolidBindings<Client> {
  const ClientContext = createContext<Client>();

  const Provider: FlowComponent<{ readonly client: Client }> = props =>
    createComponent(ClientContext.Provider, {
      value: props.client,
      get children() {
        return props.children;
      },
    });

  function useClient(): Client {
    const client = useContext(ClientContext);
    if (client === undefined) throw new Error('@zmdb/solid client is unavailable outside its Provider');
    return client;
  }

  function query<Input, Output>(
    source: SolidQuerySource<Input>,
    load: QueryLoader<Client, Input, Output>,
  ): SolidQuery<Output> {
    requireOwner('query');
    const client = useClient();
    const readSource = sourceAccessor(source);
    const [latest, setLatest] = createSignal<Output>();
    const [pending, setPending] = createSignal<PromiseLike<Output>>();
    let controller: AbortController | undefined;
    let generation = 0;
    let previousInput: Input | undefined;
    let hasPreviousInput = false;

    const [data, actions] = createResource<Output, Input>(readSource, input => {
      const changed = hasPreviousInput && !Object.is(previousInput, input);
      previousInput = input;
      hasPreviousInput = true;
      if (changed) setLatest(() => undefined);

      controller?.abort(new Error('@zmdb/solid query superseded'));
      const currentController = new AbortController();
      controller = currentController;
      const currentGeneration = ++generation;
      const operation = load(client, input, currentController.signal);
      const solidOperation = promiseForSolid(operation);
      setPending(() => operation);
      void Promise.resolve(operation).then(
        value => {
          if (currentGeneration === generation && !currentController.signal.aborted) setLatest(() => value);
          if (currentGeneration === generation) setPending(() => undefined);
        },
        () => {
          if (currentGeneration === generation) setPending(() => undefined);
        },
      );
      return solidOperation;
    });

    onCleanup(() => {
      generation++;
      controller?.abort(new Error('@zmdb/solid query owner disposed'));
      setPending(() => undefined);
    });

    return {
      data,
      latest,
      error: () => data.error,
      loading: () => data.loading,
      pending,
      async refresh() {
        actions.refetch();
        const operation = pending();
        if (operation !== undefined) await operation;
      },
    };
  }

  function mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): SolidMutation<Input, Output> {
    requireOwner('mutation');
    const client = useClient();
    const [error, setError] = createSignal<unknown>(undefined);
    const [activeCount, setActiveCount] = createSignal(0);
    const pending = createMemo(() => activeCount() > 0);
    const controllers = new Set<AbortController>();
    let generation = 0;
    let active = true;

    onCleanup(() => {
      active = false;
      generation++;
      for (const controller of controllers) {
        controller.abort(new Error('@zmdb/solid mutation owner disposed'));
      }
      controllers.clear();
    });

    return {
      error,
      pending,
      mutate(input) {
        if (!active) return Promise.reject(new Error('@zmdb/solid mutation owner is disposed'));
        const controller = new AbortController();
        const currentGeneration = ++generation;
        controllers.add(controller);
        setActiveCount(count => count + 1);
        setError(() => undefined);

        let operation: PromiseLike<Output>;
        try {
          operation = run(client, input, controller.signal);
        } catch (caught) {
          operation = Promise.reject(caught);
        }

        return Promise.resolve(operation).then(
          value => {
            if (controllers.delete(controller) && active) setActiveCount(count => count - 1);
            return value;
          },
          caught => {
            if (controllers.delete(controller) && active) setActiveCount(count => count - 1);
            if (active && currentGeneration === generation && !controller.signal.aborted) setError(() => caught);
            throw caught;
          },
        );
      },
    };
  }

  return Object.freeze({ Provider, useClient, query, mutation });
}
