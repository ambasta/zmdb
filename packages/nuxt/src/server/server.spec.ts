import { createZmdbVue } from '@zmdb/vue';
import { describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';

import { createApiClient, type ApiClient } from '../../../../fixtures/client-adapters/src/generated/api.generated.js';
import { createNuxtServerTransport, createZmdbNuxtServerPlugin } from './index.js';

interface FetchObservation {
  readonly authorization: string | null;
  readonly cookie: string | null;
  readonly hidden: string | null;
  readonly url: string;
}

function observedFetch(observations: FetchObservation[]): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const url = input instanceof Request ? input.url : String(input);
    observations.push({
      authorization: headers.get('authorization'),
      cookie: headers.get('cookie'),
      hidden: headers.get('x-hidden'),
      url,
    });
    const id = decodeURIComponent(url.split('/').at(-1) ?? '');
    return new Response(
      JSON.stringify({
        id,
        name: `${headers.get('authorization') ?? 'none'}|${headers.get('cookie') ?? 'none'}|${headers.get('x-hidden') ?? 'none'}`,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };
}

describe('@zmdb/nuxt Nitro transport (#698)', () => {
  it('each Nitro request gets an isolated client', async () => {
    const observations: FetchObservation[] = [];
    const bindings = createZmdbVue<ApiClient>('@zmdb/nuxt server isolation');
    const plugin = createZmdbNuxtServerPlugin(bindings, createApiClient, {
      baseUrl: '/api',
      fetch: observedFetch(observations),
      forwardHeaders: ['authorization'],
      forwardCookies: ['session'],
    });

    const firstApp = createSSRApp({ render: () => null });
    const secondApp = createSSRApp({ render: () => null });
    plugin({
      vueApp: firstApp,
      ssrContext: {
        event: {
          headers: new Headers({
            authorization: 'Bearer first',
            cookie: 'session=first-session; hidden=first-hidden',
            'x-hidden': 'first-secret',
          }),
        },
      },
    });
    plugin({
      vueApp: secondApp,
      ssrContext: {
        event: {
          headers: new Headers({
            authorization: 'Bearer second',
            cookie: 'session=second-session; hidden=second-hidden',
            'x-hidden': 'second-secret',
          }),
        },
      },
    });

    const firstClient = firstApp.runWithContext(() => bindings.useZmdbClient());
    const secondClient = secondApp.runWithContext(() => bindings.useZmdbClient());
    expect(firstClient).not.toBe(secondClient);
    await expect(
      Promise.all([firstClient.getWidget({ id: 'first' }), secondClient.getWidget({ id: 'second' })]),
    ).resolves.toEqual([
      {
        id: 'first',
        name: 'Bearer first|session=first-session|none',
      },
      {
        id: 'second',
        name: 'Bearer second|session=second-session|none',
      },
    ]);
    expect(observations).toEqual([
      {
        authorization: 'Bearer first',
        cookie: 'session=first-session',
        hidden: null,
        url: '/api/widgets/first',
      },
      {
        authorization: 'Bearer second',
        cookie: 'session=second-session',
        hidden: null,
        url: '/api/widgets/second',
      },
    ]);
  });

  it('server transport uses request-scoped fetch', async () => {
    const localFetch = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response(null, { status: 204 });
    });
    const incoming = new Headers({
      authorization: 'Bearer request',
      cookie: 'session=request-session; hidden=do-not-forward',
      'x-hidden': 'do-not-forward',
    });
    const transport = createNuxtServerTransport(localFetch, incoming, {
      forwardHeaders: ['authorization'],
      forwardCookies: ['session'],
    });
    incoming.set('authorization', 'Bearer mutated');
    incoming.set('cookie', 'session=mutated');

    const response = await transport({
      method: 'POST',
      url: '/api/request-scope',
      headers: {
        accept: 'application/json',
        cookie: 'operation=explicit',
      },
      body: '{}',
    });

    expect(response.status).toBe(204);
    expect(localFetch).toHaveBeenCalledTimes(1);
    const call = localFetch.mock.calls[0];
    if (call === undefined) throw new Error('request-scoped fetch was not called');
    expect(call[0]).toBe('/api/request-scope');
    expect(new Headers(call[1]?.headers)).toEqual(
      new Headers({
        accept: 'application/json',
        authorization: 'Bearer request',
        cookie: 'session=request-session; operation=explicit',
      }),
    );
  });

  it('forwards no incoming credentials without explicit allowlists', async () => {
    const localFetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const transport = createNuxtServerTransport(
      localFetch,
      new Headers({
        authorization: 'Bearer hidden',
        cookie: 'session=hidden',
      }),
    );

    await transport({
      method: 'GET',
      url: '/api/no-forwarding',
      headers: {
        accept: 'application/json',
      },
    });

    const call = localFetch.mock.calls[0];
    if (call === undefined) throw new Error('request-scoped fetch was not called');
    expect(new Headers(call[1]?.headers)).toEqual(
      new Headers({
        accept: 'application/json',
      }),
    );
  });

  it('rejects implicit cookie forwarding and transport-owned headers', () => {
    expect(() =>
      createNuxtServerTransport(vi.fn(), new Headers(), {
        forwardHeaders: ['cookie'],
      }),
    ).toThrow('use forwardCookies for cookies');
    expect(() =>
      createNuxtServerTransport(vi.fn(), new Headers(), {
        forwardHeaders: ['content-type'],
      }),
    ).toThrow('content-type is transport-owned');
    expect(() =>
      createNuxtServerTransport(vi.fn(), new Headers(), {
        forwardHeaders: ['X-Tenant-ID', 'x-tenant-id'],
      }),
    ).toThrow('header names must not contain duplicates');
    expect(() =>
      createNuxtServerTransport(vi.fn(), new Headers(), {
        forwardCookies: ['session id'],
      }),
    ).toThrow('cookie name "session id" is invalid');
  });
});
