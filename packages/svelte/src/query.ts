import { writable } from 'svelte/store';
import type { Readable, Unsubscriber } from 'svelte/store';

import { SvelteAdapterError } from './errors.js';
import { isAbort, lifecycleAbort } from './lifecycle.js';
import type { QueryLoader, QuerySnapshot, SvelteQueryStore } from './types.js';

interface QueryRequest {
  readonly controller: AbortController;
}

function property(value: unknown, name: PropertyKey): unknown {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? Reflect.get(value, name)
    : undefined;
}

function isReadable<Input>(value: Input | Readable<Input>): value is Readable<Input> {
  return typeof property(value, 'subscribe') === 'function';
}

export function createQueryStore<Client, Input, Output>(
  client: Client,
  input: Input | Readable<Input>,
  load: QueryLoader<Client, Input, Output>,
): SvelteQueryStore<Output> {
  let snapshot: QuerySnapshot<Output> = Object.freeze({
    data: undefined,
    error: undefined,
    loading: false,
  });
  const state = writable(snapshot);
  let subscribers = 0;
  let active = false;
  let destroyed = false;
  let generation = 0;
  let request: QueryRequest | undefined;
  let inputUnsubscribe: Unsubscriber | undefined;
  let currentInput: { readonly value: Input } | undefined;

  const publish = (next: QuerySnapshot<Output>): void => {
    snapshot = Object.freeze(next);
    state.set(snapshot);
  };

  const abortSelected = (reason: Error): void => {
    const selected = request;
    request = undefined;
    if (selected !== undefined && !selected.controller.signal.aborted) selected.controller.abort(reason);
  };

  const launch = async (selectedInput: Input, clearData: boolean, reason: string): Promise<void> => {
    if (destroyed) throw new SvelteAdapterError('@zmdb/svelte query store is destroyed');
    if (!active) throw new SvelteAdapterError('@zmdb/svelte query store is inactive; subscribe before refreshing');

    abortSelected(lifecycleAbort(reason));
    const selectedGeneration = ++generation;
    const controller = new AbortController();
    request = { controller };
    publish({
      data: clearData ? undefined : snapshot.data,
      error: undefined,
      loading: true,
    });

    try {
      const data = await load(client, selectedInput, controller.signal);
      if (!active || destroyed || selectedGeneration !== generation) return;
      request = undefined;
      publish({ data, error: undefined, loading: false });
    } catch (error) {
      if (active && !destroyed && selectedGeneration === generation) {
        request = undefined;
        if (!isAbort(error, controller.signal)) {
          publish({ data: snapshot.data, error, loading: false });
        }
      }
      throw error;
    }
  };

  const startForInput = (selectedInput: Input): void => {
    const changed = currentInput !== undefined && !Object.is(currentInput.value, selectedInput);
    currentInput = { value: selectedInput };
    void launch(
      selectedInput,
      changed,
      changed
        ? '@zmdb/svelte query superseded by an input-store change'
        : '@zmdb/svelte query restarted for a new subscription',
    ).catch(() => undefined);
  };

  const activate = (): void => {
    if (active || destroyed) return;
    active = true;
    if (isReadable(input)) {
      inputUnsubscribe = input.subscribe(startForInput);
    } else {
      startForInput(input);
    }
  };

  const deactivate = (reason: string): void => {
    if (!active) return;
    active = false;
    generation += 1;
    inputUnsubscribe?.();
    inputUnsubscribe = undefined;
    abortSelected(lifecycleAbort(reason));
    if (snapshot.loading) publish({ data: snapshot.data, error: snapshot.error, loading: false });
  };

  const store: SvelteQueryStore<Output> = {
    subscribe(run, invalidate) {
      if (subscribers === 0) activate();
      subscribers += 1;
      const unsubscribe = state.subscribe(run, invalidate);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        unsubscribe();
        subscribers -= 1;
        if (subscribers === 0) {
          deactivate('@zmdb/svelte query cancelled after its final subscriber left');
        }
      };
    },
    refresh() {
      if (!active) {
        return Promise.reject(
          new SvelteAdapterError(
            destroyed
              ? '@zmdb/svelte query store is destroyed'
              : '@zmdb/svelte query store is inactive; subscribe before refreshing',
          ),
        );
      }
      if (currentInput === undefined) {
        return Promise.reject(new SvelteAdapterError('@zmdb/svelte query store has no current input'));
      }
      return launch(currentInput.value, false, '@zmdb/svelte query superseded by refresh');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      deactivate('@zmdb/svelte query cancelled because its owner was destroyed');
    },
  };

  return Object.freeze(store);
}
