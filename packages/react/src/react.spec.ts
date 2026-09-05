import { createZmdbReact } from '@zmdb/react';
import type { MutationState, QueryState } from '@zmdb/react';
import { StrictMode, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

interface Pending<Value> {
  readonly signal: AbortSignal;
  resolve(value: Value): void;
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

function held<Value>(signal: AbortSignal, requests: Pending<Value>[]): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const pending = { signal, resolve };
    requests.push(pending);
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await runAct(() => {
    renderer.unmount();
  });
}

describe('@zmdb/react native lifecycle', () => {
  it('isolates clients between providers', () => {
    const react = createZmdbReact<{ readonly name: string }>('Accounts');
    const seen: string[] = [];

    function Probe() {
      seen.push(react.useZmdbClient().name);
      return null;
    }

    renderToString(
      createElement(
        'main',
        null,
        createElement(react.ZmdbClientProvider, { client: { name: 'first' } }, createElement(Probe)),
        createElement(react.ZmdbClientProvider, { client: { name: 'second' } }, createElement(Probe)),
      ),
    );

    expect(seen).toEqual(['first', 'second']);
  });

  it('throws a useful error outside ZmdbClientProvider', () => {
    const react = createZmdbReact<object>('Accounts');

    function Probe() {
      react.useZmdbClient();
      return null;
    }

    expect(() => renderToString(createElement(Probe))).toThrow(
      'Accounts client is unavailable; render this hook under Accounts.ZmdbClientProvider',
    );
  });

  it('StrictMode does not leak duplicate requests', async () => {
    const react = createZmdbReact<object>('StrictAccounts');
    const requests: Pending<string>[] = [];
    let renderer: ReactTestRenderer | undefined;

    function Probe() {
      react.useZmdbQuery((_client, signal) => held(signal, requests), []);
      return null;
    }

    await runAct(() => {
      renderer = createRenderer(
        createElement(StrictMode, null, createElement(react.ZmdbClientProvider, { client: {} }, createElement(Probe))),
      );
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(false);
    const selected = renderer;
    if (selected === undefined) throw new Error('StrictMode renderer did not mount');
    await unmount(selected);
    expect(requests[1]?.signal.aborted).toBe(true);
  });

  it('dependency changes abort the old request', async () => {
    const react = createZmdbReact<object>('DependencyAccounts');
    const requests: (Pending<string> & { readonly id: string })[] = [];
    let renderer: ReactTestRenderer | undefined;

    function Probe(props: { readonly id: string }) {
      react.useZmdbQuery(
        (_client, signal) => {
          const scoped: Pending<string>[] = [];
          const operation = held(signal, scoped);
          const pending = scoped[0];
          if (pending === undefined) throw new Error('query did not expose its pending request');
          requests.push({ ...pending, id: props.id });
          return operation;
        },
        [props.id],
      );
      return null;
    }

    function tree(id: string) {
      return createElement(react.ZmdbClientProvider, { client: {} }, createElement(Probe, { id }));
    }

    await runAct(() => {
      renderer = createRenderer(tree('first'));
    });
    const selected = renderer;
    if (selected === undefined) throw new Error('dependency renderer did not mount');
    await runAct(() => {
      selected.update(tree('second'));
    });

    expect(requests.map(request => request.id)).toEqual(['first', 'second']);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(false);
    await unmount(selected);
  });

  it('unmount aborts an active mutation', async () => {
    const react = createZmdbReact<object>('MutationAccounts');
    const requests: Pending<string>[] = [];
    let mutation: MutationState<string, string> | undefined;
    let renderer: ReactTestRenderer | undefined;

    function Probe() {
      mutation = react.useZmdbMutation((_client, input, signal) => held(signal, requests).then(() => input));
      return null;
    }

    await runAct(() => {
      renderer = createRenderer(createElement(react.ZmdbClientProvider, { client: {} }, createElement(Probe)));
    });
    const selectedMutation = mutation;
    const selectedRenderer = renderer;
    if (selectedMutation === undefined || selectedRenderer === undefined) {
      throw new Error('mutation fixture did not mount');
    }

    const operation = selectedMutation.mutate('one');
    const observedRejection = operation.then(
      () => undefined,
      error => error,
    );
    await Promise.resolve();
    const request = requests[0];
    if (request === undefined) throw new Error('mutation did not dispatch');
    await unmount(selectedRenderer);
    await expect(observedRejection).resolves.toBe(request.signal.reason);
    expect(request.signal.aborted).toBe(true);
  });

  it('an older result cannot overwrite a newer result', async () => {
    const react = createZmdbReact<object>('StaleAccounts');
    const requests: (Pending<string> & { readonly id: string })[] = [];
    let query: QueryState<string> | undefined;
    let renderer: ReactTestRenderer | undefined;

    function Probe(props: { readonly id: string }) {
      query = react.useZmdbQuery(
        (_client, signal) =>
          new Promise<string>(resolve => {
            requests.push({ id: props.id, signal, resolve });
          }),
        [props.id],
      );
      return null;
    }

    function tree(id: string) {
      return createElement(react.ZmdbClientProvider, { client: {} }, createElement(Probe, { id }));
    }

    await runAct(() => {
      renderer = createRenderer(tree('first'));
    });
    const selected = renderer;
    if (selected === undefined) throw new Error('stale-result renderer did not mount');
    await runAct(() => {
      selected.update(tree('second'));
    });
    const first = requests[0];
    const second = requests[1];
    if (first === undefined || second === undefined) throw new Error('stale-result fixture needs two requests');

    await runAct(async () => {
      second.resolve('second');
      await Promise.resolve();
    });
    expect(query?.data).toBe('second');

    await runAct(async () => {
      first.resolve('first');
      await Promise.resolve();
    });
    expect(query?.data).toBe('second');
    await unmount(selected);
  });

  it('server rendering performs no request unless invoked', async () => {
    const react = createZmdbReact<{ readonly value: string }>('ServerAccounts');
    let requests = 0;
    const load = (client: { readonly value: string }): Promise<string> => {
      requests += 1;
      return Promise.resolve(client.value);
    };

    function Probe() {
      react.useZmdbQuery(client => load(client), []);
      return null;
    }

    const client = { value: 'server' };
    renderToString(createElement(react.ZmdbClientProvider, { client }, createElement(Probe)));
    expect(requests).toBe(0);
    await expect(load(client)).resolves.toBe('server');
    expect(requests).toBe(1);
  });
});
