import { createZmdbReact } from '@zmdb/react';
import type { MutationState, QueryState } from '@zmdb/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

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

type ObservedSettlement<Value> =
  | { readonly kind: 'fulfilled'; readonly value: Value }
  | { readonly kind: 'rejected'; readonly error: unknown };

function observeSettlement<Value>(operation: Promise<Value>): Promise<ObservedSettlement<Value>> {
  return operation.then(
    value => ({ kind: 'fulfilled', value }),
    error => ({ kind: 'rejected', error }),
  );
}

async function unwrapSettlement<Value>(settlement: Promise<ObservedSettlement<Value>>): Promise<Value> {
  const outcome = await settlement;
  if (outcome.kind === 'fulfilled') return outcome.value;
  throw outcome.error;
}

function reactExpectation(): AdapterPackageExpectation {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === '@zmdb/react');
  if (expectation === undefined) throw new Error('the adapter matrix omitted @zmdb/react');
  return expectation;
}

function querySnapshot<Output>(state: QueryState<Output> | undefined): QuerySnapshot<Output> {
  return state === undefined
    ? { data: undefined, error: undefined, loading: false }
    : { data: state.data, error: state.error, loading: state.loading };
}

function mutationSnapshot<Input, Output>(state: MutationState<Input, Output> | undefined): MutationSnapshot {
  return state === undefined ? { error: undefined, pending: false } : { error: state.error, pending: state.pending };
}

function createRenderer(element: ReturnType<typeof createElement>): ReactTestRenderer {
  const originalError = console.error;
  console.error = (message?: unknown, ...rest: unknown[]): void => {
    if (message === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
    originalError(message, ...rest);
  };
  try {
    return create(element);
  } finally {
    console.error = originalError;
  }
}

async function runAct(action: () => void | Promise<void>): Promise<void> {
  const previous = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  try {
    await act(async () => {
      await action();
    });
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous);
  }
}

function mountedRenderer(renderer: ReactTestRenderer | undefined): ReactTestRenderer {
  if (renderer === undefined) throw new Error('@zmdb/react conformance renderer is not mounted');
  return renderer;
}

function mountedQuery<Output>(state: QueryState<Output> | undefined): QueryState<Output> {
  if (state === undefined) throw new Error('@zmdb/react conformance query is not mounted');
  return state;
}

function mountedMutation<Input, Output>(state: MutationState<Input, Output> | undefined): MutationState<Input, Output> {
  if (state === undefined) throw new Error('@zmdb/react conformance mutation is not mounted');
  return state;
}

function prepareReactQuery<Client extends object, Input, Output>(
  client: Client,
  initialInput: Input,
  load: QueryLoader<Client, Input, Output>,
): ConformanceQuery<Input, Output> {
  const bindings = createZmdbReact<Client>('@zmdb/react conformance');
  let input = initialInput;
  let renderer: ReactTestRenderer | undefined;
  let observed: QueryState<Output> | undefined;
  let latestSettlement = Promise.resolve();
  let disposed = false;

  function Probe(props: { readonly input: Input }) {
    observed = bindings.useZmdbQuery(
      (selectedClient, signal) => {
        const operation = Promise.resolve(load(selectedClient, props.input, signal));
        latestSettlement = operation.then(
          () => undefined,
          () => undefined,
        );
        return operation;
      },
      [props.input],
    );
    return null;
  }

  function tree() {
    return createElement(bindings.ZmdbClientProvider, { client }, createElement(Probe, { input }));
  }

  return {
    snapshot() {
      return querySnapshot(observed);
    },
    async mount() {
      if (renderer !== undefined) throw new Error('@zmdb/react conformance query mounted twice');
      await runAct(() => {
        renderer = createRenderer(tree());
      });
    },
    async update(nextInput) {
      input = nextInput;
      await runAct(() => {
        mountedRenderer(renderer).update(tree());
      });
    },
    refresh() {
      const state = mountedQuery(observed);
      let settlement: Promise<ObservedSettlement<void>> | undefined;
      const started = runAct(async () => {
        settlement = observeSettlement(state.refresh());
        await Promise.resolve();
      });
      return started.then(() => {
        if (settlement === undefined) throw new Error('@zmdb/react refresh did not start');
        return unwrapSettlement(settlement);
      });
    },
    async whenSettled() {
      await runAct(async () => {
        await latestSettlement;
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const selectedRenderer = renderer;
      renderer = undefined;
      if (selectedRenderer !== undefined) {
        await runAct(() => {
          selectedRenderer.unmount();
        });
      }
      await latestSettlement;
    },
  };
}

function prepareReactMutation<Client extends object, Input, Output>(
  client: Client,
  run: MutationRunner<Client, Input, Output>,
): ConformanceMutation<Input, Output> {
  const bindings = createZmdbReact<Client>('@zmdb/react conformance');
  let renderer: ReactTestRenderer | undefined;
  let observed: MutationState<Input, Output> | undefined;
  let disposed = false;

  function Probe() {
    observed = bindings.useZmdbMutation(run);
    return null;
  }

  function tree() {
    return createElement(bindings.ZmdbClientProvider, { client }, createElement(Probe));
  }

  return {
    snapshot() {
      return mutationSnapshot(observed);
    },
    async mount() {
      if (renderer !== undefined) throw new Error('@zmdb/react conformance mutation mounted twice');
      await runAct(() => {
        renderer = createRenderer(tree());
      });
    },
    mutate(input) {
      const state = mountedMutation(observed);
      let settlement: Promise<ObservedSettlement<Output>> | undefined;
      const started = runAct(async () => {
        settlement = observeSettlement(state.mutate(input));
        await Promise.resolve();
      });
      return started.then(() => {
        if (settlement === undefined) throw new Error('@zmdb/react mutation did not start');
        return unwrapSettlement(settlement).then(
          async value => {
            await runAct(async () => {
              await Promise.resolve();
            });
            return value;
          },
          async error => {
            await runAct(async () => {
              await Promise.resolve();
            });
            throw error;
          },
        );
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const selectedRenderer = renderer;
      renderer = undefined;
      if (selectedRenderer !== undefined) {
        await runAct(() => {
          selectedRenderer.unmount();
        });
      }
    },
  };
}

export function createReactConformanceBinding<Client extends object>(): AdapterConformanceBinding<Client> {
  return {
    package: reactExpectation(),
    prepareQuery(options) {
      return prepareReactQuery(options.client, options.input, options.load);
    },
    prepareMutation(options) {
      return prepareReactMutation(options.client, options.run);
    },
    runSsrQuery(options) {
      const bindings = createZmdbReact<Client>('@zmdb/react SSR conformance');
      const selected: { client?: Client } = {};

      function Probe() {
        selected.client = bindings.useZmdbClient();
        return null;
      }

      renderToString(createElement(bindings.ZmdbClientProvider, { client: options.client }, createElement(Probe)));
      const client = selected.client;
      if (client === undefined) throw new Error('@zmdb/react SSR provider did not expose its request client');
      return Promise.resolve(options.load(client, options.input, new AbortController().signal));
    },
  };
}
