import { DestroyRef, InjectionToken, inject, makeEnvironmentProviders, signal } from '@angular/core';
import type { EnvironmentProviders, Signal } from '@angular/core';
import { Observable } from 'rxjs';

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

export interface ZmdbSignalQuery<Input, Output> {
  readonly data: Signal<Output | undefined>;
  readonly error: Signal<unknown>;
  readonly loading: Signal<boolean>;
  setInput(input: Input): void;
  refresh(): Promise<void>;
}

export interface ZmdbSignalMutation<Input, Output> {
  readonly error: Signal<unknown>;
  readonly pending: Signal<boolean>;
  mutate(input: Input): Promise<Output>;
}

export interface ZmdbClientRef<Client> {
  readonly client: Client;
}

export interface ZmdbAngularBindings<Client> {
  readonly ZMDB_CLIENT: InjectionToken<ZmdbClientRef<Client>>;
  provideZmdbClient(client: Client): EnvironmentProviders;
  injectZmdbClient(): Client;
  zmdbQuery<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): ZmdbSignalQuery<Input, Output>;
  zmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): ZmdbSignalMutation<Input, Output>;
  zmdbObservable<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): Observable<Output>;
}

function invoke<Client, Input, Output>(
  load: QueryLoader<Client, Input, Output>,
  client: Client,
  input: Input,
  abortSignal: AbortSignal,
): Promise<Output> {
  try {
    return Promise.resolve(load(client, input, abortSignal));
  } catch (error) {
    return Promise.reject(error);
  }
}

function cancellation(action: string): Error {
  const error = new Error(`@zmdb/angular ${action}`);
  error.name = 'ZmdbAngularCancellation';
  return error;
}

function signalQuery<Client, Input, Output>(
  token: InjectionToken<ZmdbClientRef<Client>>,
  initialInput: Input,
  load: QueryLoader<Client, Input, Output>,
): ZmdbSignalQuery<Input, Output> {
  const client = inject(token).client;
  const destroyRef = inject(DestroyRef);
  const data = signal<Output | undefined>(undefined);
  const error = signal<unknown>(undefined);
  const loading = signal(false);
  let input = initialInput;
  let generation = 0;
  let active: AbortController | undefined;
  let destroyed = false;

  const start = (): Promise<void> => {
    if (destroyed) return Promise.reject(cancellation('query started after its injector was destroyed'));

    generation += 1;
    const selectedGeneration = generation;
    active?.abort(cancellation('query superseded'));
    const controller = new AbortController();
    active = controller;
    error.set(undefined);
    loading.set(true);

    return invoke(load, client, input, controller.signal).then(
      value => {
        if (!destroyed && selectedGeneration === generation) {
          data.set(value);
          error.set(undefined);
          loading.set(false);
        }
        if (active === controller) active = undefined;
      },
      failure => {
        if (!destroyed && selectedGeneration === generation && !controller.signal.aborted) {
          error.set(failure);
          loading.set(false);
        }
        if (active === controller) active = undefined;
        throw failure;
      },
    );
  };

  const startSilently = (): void => {
    void start().catch(() => undefined);
  };

  destroyRef.onDestroy(() => {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    const controller = active;
    active = undefined;
    controller?.abort(cancellation('query owner destroyed'));
    loading.set(false);
  });

  startSilently();

  return Object.freeze({
    data: data.asReadonly(),
    error: error.asReadonly(),
    loading: loading.asReadonly(),
    setInput(nextInput: Input): void {
      if (destroyed) throw cancellation('query input changed after its injector was destroyed');
      if (Object.is(input, nextInput)) return;
      input = nextInput;
      data.set(undefined);
      error.set(undefined);
      startSilently();
    },
    refresh: start,
  });
}

function signalMutation<Client, Input, Output>(
  token: InjectionToken<ZmdbClientRef<Client>>,
  run: MutationRunner<Client, Input, Output>,
): ZmdbSignalMutation<Input, Output> {
  const client = inject(token).client;
  const destroyRef = inject(DestroyRef);
  const error = signal<unknown>(undefined);
  const pending = signal(false);
  const controllers = new Set<AbortController>();
  let inFlight = 0;
  let generation = 0;
  let destroyed = false;

  destroyRef.onDestroy(() => {
    if (destroyed) return;
    destroyed = true;
    const reason = cancellation('mutation owner destroyed');
    for (const controller of controllers) controller.abort(reason);
    controllers.clear();
    inFlight = 0;
    pending.set(false);
  });

  return Object.freeze({
    error: error.asReadonly(),
    pending: pending.asReadonly(),
    mutate(input: Input): Promise<Output> {
      if (destroyed) return Promise.reject(cancellation('mutation started after its injector was destroyed'));

      generation += 1;
      const selectedGeneration = generation;
      const controller = new AbortController();
      controllers.add(controller);
      inFlight += 1;
      error.set(undefined);
      pending.set(true);

      const finish = (): void => {
        controllers.delete(controller);
        if (destroyed) return;
        inFlight -= 1;
        pending.set(inFlight > 0);
      };

      return invoke(run, client, input, controller.signal).then(
        value => {
          finish();
          return value;
        },
        failure => {
          finish();
          if (!destroyed && selectedGeneration === generation && !controller.signal.aborted) {
            error.set(failure);
          }
          throw failure;
        },
      );
    },
  });
}

function queryObservable<Client, Input, Output>(
  token: InjectionToken<ZmdbClientRef<Client>>,
  input: Input,
  load: QueryLoader<Client, Input, Output>,
): Observable<Output> {
  const client = inject(token).client;
  const destroyRef = inject(DestroyRef);

  return new Observable<Output>(subscriber => {
    if (destroyRef.destroyed) {
      subscriber.complete();
      return;
    }

    const controller = new AbortController();
    let active = true;
    const unregister = destroyRef.onDestroy(() => {
      if (!active) return;
      active = false;
      controller.abort(cancellation('Observable owner destroyed'));
      subscriber.complete();
    });

    void invoke(load, client, input, controller.signal).then(
      value => {
        if (!active) return;
        active = false;
        unregister();
        subscriber.next(value);
        subscriber.complete();
      },
      failure => {
        if (!active) return;
        active = false;
        unregister();
        subscriber.error(failure);
      },
    );

    return () => {
      unregister();
      if (!active) return;
      active = false;
      controller.abort(cancellation('Observable unsubscribed'));
    };
  });
}

export function createZmdbAngular<Client>(
  description: string = '@zmdb/angular generated client',
): ZmdbAngularBindings<Client> {
  const ZMDB_CLIENT = new InjectionToken<ZmdbClientRef<Client>>(description);

  const provideZmdbClient = (client: Client): EnvironmentProviders =>
    makeEnvironmentProviders([{ provide: ZMDB_CLIENT, useValue: Object.freeze({ client }) }]);

  const injectZmdbClient = (): Client => inject(ZMDB_CLIENT).client;

  return Object.freeze({
    ZMDB_CLIENT,
    provideZmdbClient,
    injectZmdbClient,
    zmdbQuery<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): ZmdbSignalQuery<Input, Output> {
      return signalQuery(ZMDB_CLIENT, input, load);
    },
    zmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): ZmdbSignalMutation<Input, Output> {
      return signalMutation(ZMDB_CLIENT, run);
    },
    zmdbObservable<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): Observable<Output> {
      return queryObservable(ZMDB_CLIENT, input, load);
    },
  });
}
