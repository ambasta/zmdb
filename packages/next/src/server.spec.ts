import { CLIENT_RUNTIME_ABI, createClientRuntime } from '@zmdb/client';
import type { ClientOperationResponse, ClientOptions, DecodeResult, GeneratedOperation } from '@zmdb/client';
import { describe, expect, it } from 'vitest';

import { createNextServerClientFromSources } from './server-runtime.js';
import type { NextCookieStore, NextFetch, NextFetchRequestInit, NextRequestSources } from './server-runtime.js';

interface ProbeInput {
  readonly id: string;
}

interface ProbeResult {
  readonly id: string;
}

interface ProbeClient {
  getProbe(input: ProbeInput): Promise<ProbeResult>;
}

interface CapturedRequest {
  readonly url: string;
  readonly init: NextFetchRequestInit;
}

function property(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

function decodeProbe(value: unknown): DecodeResult<ProbeResult> {
  const id = property(value, 'id');
  return typeof id === 'string'
    ? { ok: true, value: { id } }
    : { ok: false, issues: [{ path: '$.id', message: 'expected string' }] };
}

async function readProbe(response: ClientOperationResponse): Promise<ProbeResult> {
  if (response.status === 200) return response.body.json('application/json', decodeProbe);
  return response.unexpectedStatus();
}

const PROBE_OPERATION: GeneratedOperation<ProbeInput, ProbeResult> = {
  abi: CLIENT_RUNTIME_ABI,
  operationId: 'get_probe',
  method: 'GET',
  security: [],
  schemes: {},
  version: { kind: 'none' },
  prepare: input => ({
    path: `/probes/${encodeURIComponent(input.id)}`,
    query: [],
    headers: { accept: 'application/json' },
    cookies: [],
  }),
  read: readProbe,
};

function createProbeClient(options: ClientOptions): ProbeClient {
  const runtime = createClientRuntime(options);
  return Object.freeze({
    getProbe(input: ProbeInput): Promise<ProbeResult> {
      return runtime.call(PROBE_OPERATION, input);
    },
  });
}

function cookies(values: Readonly<Record<string, string>>): NextCookieStore {
  return {
    get(name) {
      const value = values[name];
      return value === undefined ? undefined : { value };
    },
  };
}

function request(
  headerValues: Readonly<Record<string, string>>,
  cookieValues: Readonly<Record<string, string>>,
): NextRequestSources {
  return {
    headers: new Headers(headerValues),
    cookies: cookies(cookieValues),
  };
}

function recordingFetch(requests: CapturedRequest[]): NextFetch {
  return async (input, init) => {
    requests.push({
      url: String(input),
      init: init ?? {},
    });
    const path = new URL(String(input)).pathname;
    const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    return Response.json({ id });
  };
}

function headersOf(captured: CapturedRequest): Readonly<Record<string, string>> {
  return Object.fromEntries(new Headers(captured.init.headers).entries());
}

describe('@zmdb/next request-scoped server client', () => {
  it('server client forwards selected headers and cookies', async () => {
    const requests: CapturedRequest[] = [];
    const scope = createNextServerClientFromSources(
      {
        createClient: createProbeClient,
        baseUrl: 'https://api.example.test',
        fetch: recordingFetch(requests),
        forward: {
          headers: ['Authorization', 'X-Tenant-ID'],
          cookies: ['session'],
        },
      },
      request(
        {
          authorization: 'Bearer selected',
          'x-tenant-id': 'tenant-one',
          'x-ignored': 'do-not-forward',
        },
        {
          session: 'session-one',
          ignored: 'do-not-forward',
        },
      ),
    );

    await expect(scope.client.getProbe({ id: 'one' })).resolves.toEqual({ id: 'one' });
    expect(requests).toHaveLength(1);
    const captured = requests[0];
    if (captured === undefined) throw new Error('Next fetch was not called');
    expect(captured.url).toBe('https://api.example.test/probes/one');
    expect(headersOf(captured)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer selected',
      cookie: 'session=session-one',
      'x-tenant-id': 'tenant-one',
    });
  });

  it('two SSR requests do not share authentication', async () => {
    const requests: CapturedRequest[] = [];
    const fetch = recordingFetch(requests);
    const first = createNextServerClientFromSources(
      {
        createClient: createProbeClient,
        baseUrl: 'https://api.example.test',
        fetch,
        forward: { headers: ['authorization'], cookies: ['session'] },
      },
      request({ authorization: 'Bearer first' }, { session: 'first-session' }),
    );
    const second = createNextServerClientFromSources(
      {
        createClient: createProbeClient,
        baseUrl: 'https://api.example.test',
        fetch,
        forward: { headers: ['authorization'], cookies: ['session'] },
      },
      request({ authorization: 'Bearer second' }, { session: 'second-session' }),
    );

    await Promise.all([first.client.getProbe({ id: 'first' }), second.client.getProbe({ id: 'second' })]);
    expect(requests.map(captured => headersOf(captured))).toEqual([
      {
        accept: 'application/json',
        authorization: 'Bearer first',
        cookie: 'session=first-session',
      },
      {
        accept: 'application/json',
        authorization: 'Bearer second',
        cookie: 'session=second-session',
      },
    ]);
  });

  it('RSC duplicate calls memoize only within one request', async () => {
    const fetch: NextFetch = () => Promise.resolve(Response.json({ id: 'unused' }));
    const first = createNextServerClientFromSources(
      {
        createClient: createProbeClient,
        baseUrl: 'https://api.example.test',
        fetch,
      },
      request({}, {}),
    );
    const second = createNextServerClientFromSources(
      {
        createClient: createProbeClient,
        baseUrl: 'https://api.example.test',
        fetch,
      },
      request({}, {}),
    );
    let calls = 0;
    const firstLoad = first.memoize(
      async (_client, id: string) => {
        calls += 1;
        await Promise.resolve();
        return `${id}:${String(calls)}`;
      },
      id => id,
    );
    const secondLoad = second.memoize(
      async (_client, id: string) => {
        calls += 1;
        await Promise.resolve();
        return `${id}:${String(calls)}`;
      },
      id => id,
    );

    await expect(Promise.all([firstLoad('same'), firstLoad('same')])).resolves.toEqual(['same:1', 'same:1']);
    await expect(secondLoad('same')).resolves.toBe('same:2');
    expect(calls).toBe(2);
  });

  it('cache and no-store options reach fetch unchanged', async () => {
    const cachedRequests: CapturedRequest[] = [];
    const noStoreRequests: CapturedRequest[] = [];
    const next = { revalidate: 60, tags: ['widgets'] };
    const cached = createNextServerClientFromSources(
      {
        createClient: createProbeClient,
        baseUrl: 'https://api.example.test',
        fetch: recordingFetch(cachedRequests),
        fetchPolicy: {
          cache: 'force-cache',
          next,
        },
      },
      request({}, {}),
    );
    const noStore = createNextServerClientFromSources(
      {
        createClient: createProbeClient,
        baseUrl: 'https://api.example.test',
        fetch: recordingFetch(noStoreRequests),
        fetchPolicy: { cache: 'no-store' },
      },
      request({}, {}),
    );

    await Promise.all([cached.client.getProbe({ id: 'cached' }), noStore.client.getProbe({ id: 'fresh' })]);
    expect(cachedRequests[0]?.init.cache).toBe('force-cache');
    expect(cachedRequests[0]?.init.next).toBe(next);
    expect(noStoreRequests[0]?.init.cache).toBe('no-store');
    expect(noStoreRequests[0]?.init.next).toBeUndefined();
  });
});
