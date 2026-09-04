import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ClientResponseError } from '@zmdb/client';
import type { Component } from 'svelte';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import {
  createAdapterClientFixture,
  flushAdapterCompletions,
  rejectionOf,
} from '../../../fixtures/client-adapters/src/index.js';
import type { Widget } from '../../../fixtures/client-adapters/src/index.js';
import { createMutationStore, createQueryStore } from './index.js';
import type { MutationSnapshot, QuerySnapshot } from './index.js';

const ROOT = join(import.meta.dirname, '../../..');

interface ServerFixture {
  readonly component: Component<Record<string, unknown>>;
  cleanup(): void;
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>(done => {
    resolve = done;
  });
  return {
    promise,
    resolve(value) {
      if (resolve === undefined) throw new Error('deferred value resolved before initialisation');
      resolve(value);
    },
  };
}

async function compileServerFixture(sources: Readonly<Record<string, string>>): Promise<ServerFixture> {
  const directory = mkdtempSync(join(ROOT, '.svelte-context-'));
  try {
    writeFileSync(
      join(directory, 'bindings.mjs'),
      "import { createZmdbSvelte } from '@zmdb/svelte';\nexport const zmdb = createZmdbSvelte();\n",
    );
    for (const [name, source] of Object.entries(sources)) {
      const generated = compile(source, {
        filename: join(directory, name),
        generate: 'server',
        dev: false,
      });
      writeFileSync(join(directory, `${name}.js`), generated.js.code);
    }
    const namespace: unknown = await import(
      `${pathToFileURL(join(directory, 'App.svelte.js')).href}?fixture=${String(Date.now())}`
    );
    if (
      typeof namespace !== 'object' ||
      namespace === null ||
      !Object.hasOwn(namespace, 'default') ||
      typeof Reflect.get(namespace, 'default') !== 'function'
    ) {
      throw new Error('compiled Svelte fixture has no component default export');
    }
    return {
      component: Reflect.get(namespace, 'default') as Component<Record<string, unknown>>,
      cleanup() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

describe('@zmdb/svelte context and store lifecycle', () => {
  it('isolates clients between component trees', async () => {
    const fixture = await compileServerFixture({
      'Child.svelte': `
<script>
  import { zmdb } from './bindings.mjs';
  const client = zmdb.getClient();
</script>
<span>{client.label}</span>
`,
      'Provider.svelte': `
<script>
  import Child from './Child.svelte.js';
  import { zmdb } from './bindings.mjs';
  let { client } = $props();
  zmdb.setClient(client);
</script>
<Child />
`,
      'App.svelte': `
<script>
  import Provider from './Provider.svelte.js';
</script>
<Provider client={{ label: 'left-tree' }} />
<Provider client={{ label: 'right-tree' }} />
`,
    });
    try {
      const output = render(fixture.component).body;
      expect(output).toContain('left-tree');
      expect(output).toContain('right-tree');
      expect(output.indexOf('left-tree')).toBeLessThan(output.indexOf('right-tree'));
    } finally {
      fixture.cleanup();
    }
  });

  it('does not request before the first subscription', async () => {
    const { client, transport } = createAdapterClientFixture();
    const store = createQueryStore(client, { id: 'one' }, (api, input, signal) => api.getWidget(input, { signal }));
    expect(transport.requests).toEqual([]);

    let snapshot: QuerySnapshot<Widget> = { data: undefined, error: undefined, loading: false };
    const unsubscribe = store.subscribe(next => {
      snapshot = next;
    });
    const request = await transport.nextRequest();
    expect(snapshot.loading).toBe(true);
    request.respondJson(200, { id: 'one', name: 'One' });
    await flushAdapterCompletions();
    expect(snapshot).toEqual({
      data: { id: 'one', name: 'One' },
      error: undefined,
      loading: false,
    });
    unsubscribe();
    transport.assertIdle('lazy Svelte query');
  });

  it('final unsubscribe aborts an active request', async () => {
    const { client, transport } = createAdapterClientFixture();
    const store = createQueryStore(client, { id: 'one' }, (api, input, signal) => api.getWidget(input, { signal }));
    const first = store.subscribe(() => undefined);
    const second = store.subscribe(() => undefined);
    const request = await transport.nextRequest();

    first();
    expect(request.request.signal?.aborted).toBe(false);
    second();
    await expect(request.whenAborted()).resolves.toBe(request.request.signal?.reason);
    expect(request.request.signal?.aborted).toBe(true);
    expect(request.abortReason).toBe(request.request.signal?.reason);
    transport.assertIdle('final Svelte unsubscribe');
  });

  it('input-store changes suppress stale results', async () => {
    const client = Object.freeze({ kind: 'generated-client' });
    const input = writable({ id: 'first' });
    const requests: {
      readonly input: { readonly id: string };
      readonly signal: AbortSignal;
      readonly result: Deferred<Widget>;
    }[] = [];
    const store = createQueryStore(client, input, (_api, value, signal) => {
      const result = deferred<Widget>();
      requests.push({ input: value, signal, result });
      return result.promise;
    });
    let snapshot: QuerySnapshot<Widget> = { data: undefined, error: undefined, loading: false };
    const unsubscribe = store.subscribe(next => {
      snapshot = next;
    });
    expect(requests).toHaveLength(1);

    input.set({ id: 'second' });
    expect(requests).toHaveLength(2);
    const first = requests[0];
    const second = requests[1];
    if (first === undefined || second === undefined) throw new Error('Svelte query fixture omitted a request');
    expect(first.input).toEqual({ id: 'first' });
    expect(first.signal.aborted).toBe(true);
    expect(second.input).toEqual({ id: 'second' });
    second.result.resolve({ id: 'second', name: 'Second' });
    await flushAdapterCompletions();
    first.result.resolve({ id: 'first', name: 'Late first' });
    await flushAdapterCompletions();

    expect(snapshot).toEqual({
      data: { id: 'second', name: 'Second' },
      error: undefined,
      loading: false,
    });
    unsubscribe();
  });

  it('SSR component trees do not share state', async () => {
    const fixture = await compileServerFixture({
      'Child.svelte': `
<script>
  import { zmdb } from './bindings.mjs';
  const client = zmdb.getClient();
</script>
<strong>{client.credential}</strong>
`,
      'App.svelte': `
<script>
  import Child from './Child.svelte.js';
  import { zmdb } from './bindings.mjs';
  let { client } = $props();
  zmdb.setClient(client);
</script>
<Child />
`,
    });
    try {
      const first = render(fixture.component, { props: { client: { credential: 'first-request' } } }).body;
      const second = render(fixture.component, { props: { client: { credential: 'second-request' } } }).body;
      expect(first).toContain('first-request');
      expect(first).not.toContain('second-request');
      expect(second).toContain('second-request');
      expect(second).not.toContain('first-request');
    } finally {
      fixture.cleanup();
    }
  });

  it('component destruction aborts active work', async () => {
    const fixture = await compileServerFixture({
      'App.svelte': `
<script>
  import { zmdb } from './bindings.mjs';
  let { client, observe } = $props();
  zmdb.setClient(client);
  const query = zmdb.query({ id: 'owner' }, (_api, _input, signal) => observe(signal));
  const mutation = zmdb.mutation((_api, _input, signal) => observe(signal));
  query.subscribe(() => undefined);
  mutation.subscribe(() => undefined);
  void mutation.mutate({ id: 'mutation-owner' }).catch(() => undefined);
</script>
<span>{query.refresh.name}:{mutation.mutate.name}</span>
`,
    });
    const observedSignals: AbortSignal[] = [];
    const observe = (signal: AbortSignal): Promise<never> => {
      observedSignals.push(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    try {
      const output = render(fixture.component, {
        props: {
          client: Object.freeze({ kind: 'component-client' }),
          observe,
        },
      });
      expect({ body: output.body, observed: observedSignals.length }).toEqual({
        body: expect.stringContaining('refresh:mutate'),
        observed: 2,
      });
      expect(observedSignals.every(signal => signal.aborted)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('final mutation unsubscribe aborts every active request', async () => {
    const { client, transport } = createAdapterClientFixture();
    const store = createMutationStore(client, (api, input: { readonly id: string; readonly name: string }, signal) =>
      api.renameWidget(input, { signal }),
    );
    let pending = false;
    const unsubscribe = store.subscribe(snapshot => {
      pending = snapshot.pending;
    });

    const operation = store.mutate({ id: 'one', name: 'Renamed' });
    const request = await transport.nextRequest();
    expect(pending).toBe(true);
    unsubscribe();

    await expect(request.whenAborted()).resolves.toBe(request.request.signal?.reason);
    await expect(rejectionOf(operation)).resolves.toBe(request.request.signal?.reason);
    expect(request.request.signal?.aborted).toBe(true);
    transport.assertIdle('final Svelte mutation unsubscribe');
  });

  it('mutation errors preserve client error identity', async () => {
    const { client, transport } = createAdapterClientFixture();
    const store = createMutationStore(client, (api, input: { readonly id: string; readonly name: string }, signal) =>
      api.renameWidget(input, { signal }),
    );
    let snapshot: MutationSnapshot = { error: undefined, pending: false };
    const unsubscribe = store.subscribe(next => {
      snapshot = next;
    });

    const operation = store.mutate({ id: 'one', name: 'Conflict' });
    (await transport.nextRequest()).respondJson(409, { code: 'conflict', message: 'already renamed' });
    const error = await rejectionOf(operation);

    expect(error).toBeInstanceOf(ClientResponseError);
    expect(snapshot.error).toBe(error);
    expect(snapshot.pending).toBe(false);
    unsubscribe();
    transport.assertIdle('Svelte mutation identity');
  });

  it('starts a fresh request after the store gains subscribers again', async () => {
    const { client, transport } = createAdapterClientFixture();
    const store = createQueryStore(client, { id: 'one' }, (api, input, signal) => api.getWidget(input, { signal }));
    const firstUnsubscribe = store.subscribe(() => undefined);
    const first = await transport.nextRequest();
    first.respondJson(200, { id: 'one', name: 'First' });
    await flushAdapterCompletions();
    firstUnsubscribe();

    const secondUnsubscribe = store.subscribe(() => undefined);
    const second = await transport.nextRequest();
    expect(second.sequence).toBe(2);
    second.respondJson(200, { id: 'one', name: 'Second' });
    await flushAdapterCompletions();
    secondUnsubscribe();
    transport.assertIdle('Svelte resubscription');
  });
});
