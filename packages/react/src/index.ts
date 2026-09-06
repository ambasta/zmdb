import type { ClientRuntime } from '@zmdb/client';
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DependencyList, ReactElement, ReactNode } from 'react';

export type QueryLoader<Client, Output> = (client: Client, signal: AbortSignal) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AbortSignal,
) => PromiseLike<Output>;

export interface QueryState<Output> {
  readonly data: Output | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  refresh(): Promise<void>;
}

export interface MutationState<Input, Output> {
  readonly error: unknown;
  readonly pending: boolean;
  mutate(input: Input): Promise<Output>;
}

export type ZmdbReactRequestKind = 'mutation' | 'query';

/**
 * Per-provider request observation for official adapters that add an
 * environment lifecycle around the React hooks.
 */
export interface ZmdbReactRequestLifecycle {
  register(kind: ZmdbReactRequestKind, controller: AbortController): (() => void) | void;
}

export interface ZmdbClientProviderProps<Client> {
  readonly client: Client;
  readonly children?: ReactNode;
  readonly requestLifecycle?: ZmdbReactRequestLifecycle;
}

export interface ZmdbReactBindings<Client extends object> {
  ZmdbClientProvider(props: ZmdbClientProviderProps<Client>): ReactElement;
  useZmdbClient(): Client;
  useZmdbQuery<Output>(load: QueryLoader<Client, Output>, dependencies: DependencyList): QueryState<Output>;
  useZmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): MutationState<Input, Output>;
}

interface MissingClient {
  readonly kind: 'missing';
}

interface PresentClient<Client> {
  readonly kind: 'client';
  readonly client: Client;
  readonly requestLifecycle: ZmdbReactRequestLifecycle | undefined;
}

type ClientContextValue<Client> = MissingClient | PresentClient<Client>;

interface QuerySnapshot<Output> {
  readonly data: Output | undefined;
  readonly error: unknown;
  readonly loading: boolean;
}

interface MutationSnapshot {
  readonly error: unknown;
  readonly pending: boolean;
}

const MISSING_CLIENT: MissingClient = Object.freeze({ kind: 'missing' });

function querySnapshot<Output>(): QuerySnapshot<Output> {
  return { data: undefined, error: undefined, loading: false };
}

function mutationSnapshot(): MutationSnapshot {
  return { error: undefined, pending: false };
}

function abort(controller: AbortController | undefined, reason: Error): void {
  if (controller !== undefined && !controller.signal.aborted) controller.abort(reason);
}

function once(cleanup: (() => void) | void): () => void {
  let complete = false;
  return () => {
    if (complete) return;
    complete = true;
    cleanup?.();
  };
}

export function createZmdbReact<Client extends object = ClientRuntime>(
  bindingName = '@zmdb/react',
): ZmdbReactBindings<Client> {
  const ClientContext = createContext<ClientContextValue<Client>>(MISSING_CLIENT);

  function ZmdbClientProvider(props: ZmdbClientProviderProps<Client>): ReactElement {
    return createElement(
      ClientContext.Provider,
      {
        value: {
          kind: 'client',
          client: props.client,
          requestLifecycle: props.requestLifecycle,
        },
      },
      props.children,
    );
  }

  function useClientContext(): PresentClient<Client> {
    const value = useContext(ClientContext);
    if (value.kind === 'client') return value;
    throw new Error(`${bindingName} client is unavailable; render this hook under ${bindingName}.ZmdbClientProvider`);
  }

  function useZmdbClient(): Client {
    return useClientContext().client;
  }

  function useZmdbQuery<Output>(load: QueryLoader<Client, Output>, dependencies: DependencyList): QueryState<Output> {
    const { client, requestLifecycle } = useClientContext();
    const selectedLoad = useCallback(load, dependencies);
    const [snapshot, setSnapshot] = useState<QuerySnapshot<Output>>(querySnapshot);
    const active = useRef(false);
    const generation = useRef(0);
    const controller = useRef<AbortController | undefined>(undefined);
    const unregister = useRef<(() => void) | undefined>(undefined);

    const start = useCallback(
      (clearData: boolean): Promise<void> => {
        if (!active.current) {
          return Promise.reject(new Error(`${bindingName} query is not mounted`));
        }

        generation.current += 1;
        const selectedGeneration = generation.current;
        const previousController = controller.current;
        const previousUnregister = unregister.current;
        controller.current = undefined;
        unregister.current = undefined;
        abort(previousController, new Error(`${bindingName} query was superseded`));
        previousUnregister?.();

        const selectedController = new AbortController();
        const selectedUnregister = once(requestLifecycle?.register('query', selectedController));
        controller.current = selectedController;
        unregister.current = selectedUnregister;
        setSnapshot(previous => ({
          data: clearData ? undefined : previous.data,
          error: undefined,
          loading: true,
        }));

        const onAbort = (): void => {
          if (active.current && generation.current === selectedGeneration) {
            setSnapshot(previous => ({ data: previous.data, error: undefined, loading: false }));
          }
        };
        selectedController.signal.addEventListener('abort', onAbort, { once: true });
        if (selectedController.signal.aborted) onAbort();

        const finish = (): void => {
          selectedController.signal.removeEventListener('abort', onAbort);
          selectedUnregister();
          if (controller.current === selectedController) {
            controller.current = undefined;
            unregister.current = undefined;
          }
        };

        const operation = Promise.resolve().then(() => selectedLoad(client, selectedController.signal));
        return operation.then(
          value => {
            if (active.current && generation.current === selectedGeneration && !selectedController.signal.aborted) {
              setSnapshot({ data: value, error: undefined, loading: false });
            }
            finish();
          },
          error => {
            if (active.current && generation.current === selectedGeneration && !selectedController.signal.aborted) {
              setSnapshot(previous => ({ data: previous.data, error, loading: false }));
            }
            finish();
            throw error;
          },
        );
      },
      [bindingName, client, requestLifecycle, selectedLoad],
    );

    useEffect(() => {
      active.current = true;
      void start(true).catch(() => undefined);
      return () => {
        active.current = false;
        generation.current += 1;
        const selectedController = controller.current;
        const selectedUnregister = unregister.current;
        controller.current = undefined;
        unregister.current = undefined;
        abort(selectedController, new Error(`${bindingName} query owner was disposed`));
        selectedUnregister?.();
      };
    }, [bindingName, start]);

    const refresh = useCallback(() => start(false), [start]);
    return { ...snapshot, refresh };
  }

  function useZmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): MutationState<Input, Output> {
    const { client, requestLifecycle } = useClientContext();
    const [snapshot, setSnapshot] = useState<MutationSnapshot>(mutationSnapshot);
    const active = useRef(false);
    const pending = useRef(0);
    const newest = useRef(0);
    const controllers = useRef(new Map<AbortController, () => void>());

    useEffect(() => {
      active.current = true;
      return () => {
        active.current = false;
        for (const [selectedController, selectedUnregister] of controllers.current) {
          abort(selectedController, new Error(`${bindingName} mutation owner was disposed`));
          selectedUnregister();
        }
        controllers.current.clear();
      };
    }, [bindingName]);

    const mutate = useCallback(
      (input: Input): Promise<Output> => {
        if (!active.current) {
          return Promise.reject(new Error(`${bindingName} mutation is not mounted`));
        }

        newest.current += 1;
        const selectedGeneration = newest.current;
        const selectedController = new AbortController();
        const selectedUnregister = once(requestLifecycle?.register('mutation', selectedController));
        controllers.current.set(selectedController, selectedUnregister);
        pending.current += 1;
        setSnapshot({ error: undefined, pending: true });

        const finish = (): void => {
          controllers.current.delete(selectedController);
          selectedUnregister();
          pending.current -= 1;
        };

        const operation = Promise.resolve().then(() => run(client, input, selectedController.signal));
        return operation.then(
          value => {
            finish();
            if (active.current) {
              setSnapshot(previous => ({ error: previous.error, pending: pending.current > 0 }));
            }
            return value;
          },
          error => {
            finish();
            if (active.current) {
              setSnapshot(previous => ({
                error:
                  selectedGeneration === newest.current && !selectedController.signal.aborted ? error : previous.error,
                pending: pending.current > 0,
              }));
            }
            throw error;
          },
        );
      },
      [bindingName, client, requestLifecycle, run],
    );

    return { ...snapshot, mutate };
  }

  return Object.freeze({
    ZmdbClientProvider,
    useZmdbClient,
    useZmdbQuery,
    useZmdbMutation,
  });
}
