import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createMutationStore, createQueryStore } from '@zmdb/svelte';
import type { Component } from 'svelte';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import type { Unsubscriber } from 'svelte/store';

import type {
  AdapterConformanceBinding,
  ApiClient,
  ConformanceMutation,
  ConformanceQuery,
  MutationRunner,
  MutationSnapshot,
  QueryLoader,
  QuerySnapshot,
} from './index.js';
import { ADAPTER_PACKAGES } from './package-matrix.js';

const ROOT = join(import.meta.dirname, '../../..');

type SsrProbe = Component<{
  readonly client: ApiClient;
  readonly select: (client: ApiClient) => void;
}>;

let ssrProbePromise: Promise<SsrProbe> | undefined;

function svelteExpectation() {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === '@zmdb/svelte');
  if (expectation === undefined) throw new Error('adapter matrix omitted @zmdb/svelte');
  return expectation;
}

function settledObservation<Output>(read: () => QuerySnapshot<Output>): {
  observe(snapshot: QuerySnapshot<Output>): void;
  whenSettled(): Promise<void>;
} {
  let resolve: (() => void) | undefined;
  let waiting: Promise<void> | undefined;

  return {
    observe(snapshot) {
      if (snapshot.loading) return;
      resolve?.();
      resolve = undefined;
      waiting = undefined;
    },
    whenSettled() {
      if (!read().loading) return Promise.resolve();
      waiting ??= new Promise<void>(done => {
        resolve = done;
      });
      return waiting;
    },
  };
}

function prepareQuery<Input, Output>(options: {
  readonly client: ApiClient;
  readonly input: Input;
  readonly load: QueryLoader<ApiClient, Input, Output>;
}): ConformanceQuery<Input, Output> {
  const input = writable<Input>(options.input);
  const store = createQueryStore(options.client, input, options.load);
  let snapshot: QuerySnapshot<Output> = { data: undefined, error: undefined, loading: false };
  let unsubscribe: Unsubscriber | undefined;
  const observation = settledObservation(() => snapshot);

  return {
    snapshot() {
      return snapshot;
    },
    async mount() {
      if (unsubscribe !== undefined) throw new Error('@zmdb/svelte query conformance store mounted twice');
      unsubscribe = store.subscribe(next => {
        snapshot = next;
        observation.observe(next);
      });
    },
    async update(next) {
      input.set(next);
    },
    refresh() {
      return store.refresh();
    },
    whenSettled() {
      return observation.whenSettled();
    },
    async dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

function prepareMutation<Input, Output>(options: {
  readonly client: ApiClient;
  readonly run: MutationRunner<ApiClient, Input, Output>;
}): ConformanceMutation<Input, Output> {
  const store = createMutationStore(options.client, options.run);
  let snapshot: MutationSnapshot = { error: undefined, pending: false };
  let unsubscribe: Unsubscriber | undefined;

  return {
    snapshot() {
      return snapshot;
    },
    async mount() {
      if (unsubscribe !== undefined) throw new Error('@zmdb/svelte mutation conformance store mounted twice');
      unsubscribe = store.subscribe(next => {
        snapshot = next;
      });
    },
    mutate(input) {
      return store.mutate(input);
    },
    async dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

async function compileSsrProbe(): Promise<SsrProbe> {
  const directory = mkdtempSync(join(ROOT, '.svelte-conformance-'));
  try {
    writeFileSync(
      join(directory, 'bindings.mjs'),
      "import { createZmdbSvelte } from '@zmdb/svelte';\nexport const zmdb = createZmdbSvelte();\n",
    );
    const generated = compile(
      `
<script>
  import { zmdb } from './bindings.mjs';
  let { client, select } = $props();
  zmdb.setClient(client);
  select(zmdb.getClient());
</script>
`,
      {
        filename: join(directory, 'Probe.svelte'),
        generate: 'server',
        dev: false,
      },
    );
    const path = join(directory, 'Probe.svelte.js');
    writeFileSync(path, generated.js.code);
    const namespace: unknown = await import(`${pathToFileURL(path).href}?fixture=${String(Date.now())}`);
    if (
      typeof namespace !== 'object' ||
      namespace === null ||
      !Object.hasOwn(namespace, 'default') ||
      typeof Reflect.get(namespace, 'default') !== 'function'
    ) {
      throw new Error('compiled Svelte SSR conformance fixture has no component default export');
    }
    return Reflect.get(namespace, 'default') as SsrProbe;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function ssrProbe(): Promise<SsrProbe> {
  ssrProbePromise ??= compileSsrProbe();
  return ssrProbePromise;
}

async function runSsrQuery<Input, Output>(options: {
  readonly client: ApiClient;
  readonly input: Input;
  readonly load: QueryLoader<ApiClient, Input, Output>;
}): Promise<Output> {
  const component = await ssrProbe();
  let selectedClient: ApiClient | undefined;
  void render(component, {
    props: {
      client: options.client,
      select(client) {
        selectedClient = client;
      },
    },
  }).body;
  if (selectedClient === undefined) throw new Error('@zmdb/svelte SSR context did not expose its request client');
  const controller = new AbortController();
  return Promise.resolve(options.load(selectedClient, options.input, controller.signal));
}

export function createSvelteAdapterConformanceBinding(): AdapterConformanceBinding<ApiClient> {
  return {
    package: svelteExpectation(),
    prepareQuery,
    prepareMutation,
    runSsrQuery,
  };
}
