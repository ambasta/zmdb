import { writable } from 'svelte/store';

import { SvelteAdapterError } from './errors.js';
import { isAbort, lifecycleAbort } from './lifecycle.js';
import type { MutationRunner, MutationSnapshot, SvelteMutationStore } from './types.js';

interface MutationRequest {
  readonly controller: AbortController;
  readonly epoch: number;
}

export function createMutationStore<Client, Input, Output>(
  client: Client,
  run: MutationRunner<Client, Input, Output>,
): SvelteMutationStore<Input, Output> {
  let snapshot: MutationSnapshot = Object.freeze({ error: undefined, pending: false });
  const state = writable(snapshot);
  const requests = new Map<number, MutationRequest>();
  let subscribers = 0;
  let destroyed = false;
  let epoch = 0;
  let sequence = 0;
  let latestSequence = 0;

  const publish = (next: MutationSnapshot): void => {
    snapshot = Object.freeze(next);
    state.set(snapshot);
  };

  const pendingInCurrentEpoch = (): boolean => [...requests.values()].some(request => request.epoch === epoch);

  const cancelActive = (reason: string): void => {
    epoch += 1;
    const abortReason = lifecycleAbort(reason);
    for (const request of requests.values()) {
      if (!request.controller.signal.aborted) request.controller.abort(abortReason);
    }
    if (snapshot.pending) publish({ error: snapshot.error, pending: false });
  };

  const store: SvelteMutationStore<Input, Output> = {
    subscribe(runSubscriber, invalidate) {
      subscribers += 1;
      const unsubscribe = state.subscribe(runSubscriber, invalidate);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        unsubscribe();
        subscribers -= 1;
        if (subscribers === 0 && requests.size > 0) {
          cancelActive('@zmdb/svelte mutation cancelled after its final subscriber left');
        }
      };
    },
    async mutate(input) {
      if (destroyed) throw new SvelteAdapterError('@zmdb/svelte mutation store is destroyed');
      const selectedEpoch = epoch;
      const selectedSequence = ++sequence;
      latestSequence = selectedSequence;
      const controller = new AbortController();
      requests.set(selectedSequence, { controller, epoch: selectedEpoch });
      publish({ error: undefined, pending: true });

      try {
        return await run(client, input, controller.signal);
      } catch (error) {
        if (
          !destroyed &&
          selectedEpoch === epoch &&
          selectedSequence === latestSequence &&
          !isAbort(error, controller.signal)
        ) {
          publish({ error, pending: pendingInCurrentEpoch() });
        }
        throw error;
      } finally {
        requests.delete(selectedSequence);
        if (!destroyed && selectedEpoch === epoch) {
          publish({ error: snapshot.error, pending: pendingInCurrentEpoch() });
        }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelActive('@zmdb/svelte mutation cancelled because its owner was destroyed');
    },
  };

  return Object.freeze(store);
}
