import { createZmdbSolid, type SolidMutation, type SolidQuery } from '@zmdb/solid';
import { createComponent, createRoot, createSignal, Suspense } from 'solid-js';
import { renderToStringAsync } from 'solid-js/web';

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

function solidPackageExpectation() {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === '@zmdb/solid');
  if (expectation === undefined) throw new Error('missing @zmdb/solid package expectation');
  return expectation;
}

const SOLID_PACKAGE = solidPackageExpectation();

function requireValue<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Solid conformance ${label} is unavailable before mount`);
  return value;
}

async function settle(loading: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    if (!loading()) return;
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
  throw new Error('Solid conformance request did not settle');
}

function prepareSolidQuery<Client, Input, Output>(options: {
  readonly client: Client;
  readonly input: Input;
  readonly load: QueryLoader<Client, Input, Output>;
}): ConformanceQuery<Input, Output> {
  let query: SolidQuery<Output> | undefined;
  let updateInput: ((input: Input) => void) | undefined;
  let dispose: (() => void) | undefined;
  let mounted = false;

  return {
    snapshot(): QuerySnapshot<Output> {
      if (!mounted) return { data: undefined, error: undefined, loading: false };
      const current = requireValue(query, 'query');
      return { data: current.latest(), error: current.error(), loading: current.loading() };
    },
    async mount() {
      if (mounted) throw new Error('Solid conformance query mounted twice');
      mounted = true;
      dispose = createRoot(disposeRoot => {
        const [inputBox, setInputBox] = createSignal({ value: options.input }, { equals: false });
        updateInput = input => {
          setInputBox({ value: input });
        };
        const bindings = createZmdbSolid<Client>();
        createComponent(bindings.Provider, {
          client: options.client,
          get children() {
            query = bindings.query(() => inputBox().value, options.load);
            return undefined;
          },
        });
        return disposeRoot;
      });
    },
    async update(input) {
      requireValue(updateInput, 'input setter')(input);
      await Promise.resolve();
    },
    async refresh() {
      await requireValue(query, 'query').refresh();
    },
    async whenSettled() {
      await settle(requireValue(query, 'query').loading);
    },
    async dispose() {
      dispose?.();
      dispose = undefined;
    },
  };
}

function prepareSolidMutation<Client, Input, Output>(options: {
  readonly client: Client;
  readonly run: MutationRunner<Client, Input, Output>;
}): ConformanceMutation<Input, Output> {
  let mutation: SolidMutation<Input, Output> | undefined;
  let dispose: (() => void) | undefined;
  let mounted = false;

  return {
    snapshot(): MutationSnapshot {
      if (!mounted) return { error: undefined, pending: false };
      const current = requireValue(mutation, 'mutation');
      return { error: current.error(), pending: current.pending() };
    },
    async mount() {
      if (mounted) throw new Error('Solid conformance mutation mounted twice');
      mounted = true;
      dispose = createRoot(disposeRoot => {
        const bindings = createZmdbSolid<Client>();
        createComponent(bindings.Provider, {
          client: options.client,
          get children() {
            mutation = bindings.mutation(options.run);
            return undefined;
          },
        });
        return disposeRoot;
      });
    },
    mutate(input) {
      return requireValue(mutation, 'mutation').mutate(input);
    },
    async dispose() {
      dispose?.();
      dispose = undefined;
    },
  };
}

async function runSolidSsrQuery<Client, Input, Output>(options: {
  readonly client: Client;
  readonly input: Input;
  readonly load: QueryLoader<Client, Input, Output>;
}): Promise<Output> {
  const bindings = createZmdbSolid<Client>();
  let query: SolidQuery<Output> | undefined;
  let operation: PromiseLike<Output> | undefined;

  await renderToStringAsync(() =>
    createComponent(bindings.Provider, {
      client: options.client,
      get children() {
        query = bindings.query(options.input, options.load);
        operation = query.pending();
        return createComponent(Suspense, {
          fallback: '',
          get children() {
            query?.data();
            return '';
          },
        });
      },
    }),
  );

  const current = requireValue(query, 'SSR query');
  const value = await requireValue(operation, 'SSR query operation');
  if (!Object.is(current.latest(), value)) {
    throw new Error('Solid SSR resource did not publish its request-local result');
  }
  return value;
}

export function createSolidAdapterBinding<Client>(): AdapterConformanceBinding<Client> {
  return {
    package: SOLID_PACKAGE,
    prepareQuery(options) {
      return prepareSolidQuery(options);
    },
    prepareMutation(options) {
      return prepareSolidMutation(options);
    },
    runSsrQuery(options) {
      return runSolidSsrQuery(options);
    },
  };
}
