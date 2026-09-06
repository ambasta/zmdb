import { error, redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { createApiClient, rejectionOf, type ApiClient } from '../../../fixtures/client-adapters/src/index.js';
import { createSvelteKitServerFetch, createSvelteKitServerLoad, type SvelteKitServerLoadEvent } from './server.js';

interface FetchObservation {
  readonly url: string;
  readonly headers: Headers;
  readonly credentials: RequestCredentials | undefined;
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function cookieJar(values: Readonly<Record<string, string>>): Cookies {
  const current = new Map(Object.entries(values));
  return {
    get(name) {
      return current.get(name);
    },
    getAll() {
      return [...current].map(([name, value]) => ({ name, value }));
    },
    set(name, value) {
      current.set(name, value);
    },
    delete(name) {
      current.delete(name);
    },
    serialize(name, value) {
      return `${name}=${encodeURIComponent(value)}`;
    },
  };
}

function eventFixture(options: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly cookies?: Readonly<Record<string, string>>;
  readonly fetch: typeof globalThis.fetch;
  readonly depends?: (key: string) => void;
  readonly signal?: AbortSignal;
}): SvelteKitServerLoadEvent {
  const init: RequestInit = {};
  if (options.headers !== undefined) init.headers = options.headers;
  if (options.signal !== undefined) init.signal = options.signal;
  return {
    request: new Request('http://app.test/page', init),
    cookies: cookieJar(options.cookies ?? {}),
    fetch: options.fetch,
    depends: options.depends ?? (() => undefined),
  };
}

describe('@zmdb/sveltekit server transport and loads', () => {
  it('server load uses event.fetch', async () => {
    const observations: FetchObservation[] = [];
    const dependencies: string[] = [];
    const event = eventFixture({
      headers: {
        authorization: 'Bearer request-token',
        'x-tenant': 'tenant-one',
      },
      cookies: {
        ignored: 'not-forwarded',
        session: 'session one',
      },
      depends: key => dependencies.push(key),
      fetch: async (input, init) => {
        observations.push({
          url: inputUrl(input),
          headers: new Headers(init?.headers),
          credentials: init?.credentials,
        });
        return Response.json({ id: 'one', name: 'One' });
      },
    });
    const load = createSvelteKitServerLoad({
      key: 'widget:one',
      createClient: createApiClient,
      clientOptions: {
        baseUrl: '/api',
        forward: {
          headers: ['x-tenant'],
          cookies: ['session'],
        },
      },
      load: (client, _event, signal) => client.getWidget({ id: 'one' }, { signal }),
    });

    await expect(load(event)).resolves.toEqual({ id: 'one', name: 'One' });
    expect(dependencies).toEqual(['widget:one']);
    expect(observations).toHaveLength(1);
    const observation = observations[0];
    if (observation === undefined) throw new Error('server load did not call event.fetch');
    expect(observation.url).toBe('/api/widgets/one');
    expect(observation.credentials).toBe('omit');
    expect(observation.headers.get('x-tenant')).toBe('tenant-one');
    expect(observation.headers.get('cookie')).toBe('session=session%20one');
    expect(observation.headers.has('authorization')).toBe(false);
    expect(observation.headers.get('cookie')).not.toContain('ignored');
  });

  it('forwards no request credentials without an explicit allow-list', async () => {
    const observations: FetchObservation[] = [];
    const event = eventFixture({
      headers: {
        authorization: 'Bearer hidden',
        cookie: 'session=hidden',
        'x-tenant': 'hidden',
      },
      cookies: { session: 'hidden' },
      fetch: async (input, init) => {
        observations.push({
          url: inputUrl(input),
          headers: new Headers(init?.headers),
          credentials: init?.credentials,
        });
        return new Response(null, { status: 204 });
      },
    });

    await createSvelteKitServerFetch(event)('/probe');
    const observation = observations[0];
    if (observation === undefined) throw new Error('server fetch wrapper did not invoke event.fetch');
    expect(observation.credentials).toBe('omit');
    expect(observation.headers.has('authorization')).toBe(false);
    expect(observation.headers.has('cookie')).toBe(false);
    expect(observation.headers.has('x-tenant')).toBe(false);
  });

  it('concurrent requests do not share clients or credentials', async () => {
    const clients: ApiClient[] = [];
    const observed = new Map<string, { readonly tenant: string | null; readonly cookie: string | null }>();
    const createClient = (options: Parameters<typeof createApiClient>[0]): ApiClient => {
      const client = createApiClient(options);
      clients.push(client);
      return client;
    };
    const makeEvent = (id: string, tenant: string, session: string): SvelteKitServerLoadEvent =>
      eventFixture({
        headers: { 'x-request-id': id, 'x-tenant': tenant },
        cookies: { session },
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          observed.set(id, {
            tenant: headers.get('x-tenant'),
            cookie: headers.get('cookie'),
          });
          await Promise.resolve();
          return Response.json({ id, name: `${headers.get('x-tenant')}:${headers.get('cookie')}` });
        },
      });
    const load = createSvelteKitServerLoad({
      key: 'widget:request',
      createClient,
      clientOptions: {
        baseUrl: '/api',
        forward: {
          headers: ['x-tenant'],
          cookies: ['session'],
        },
      },
      load: (client, event, signal) => {
        const id = event.request.headers.get('x-request-id');
        if (id === null) throw new Error('request fixture omitted x-request-id');
        return client.getWidget({ id }, { signal });
      },
    });

    await expect(
      Promise.all([
        load(makeEvent('first', 'tenant-first', 'session-first')),
        load(makeEvent('second', 'tenant-second', 'session-second')),
      ]),
    ).resolves.toEqual([
      { id: 'first', name: 'tenant-first:session=session-first' },
      { id: 'second', name: 'tenant-second:session=session-second' },
    ]);
    expect(clients).toHaveLength(2);
    expect(Object.is(clients[0], clients[1])).toBe(false);
    expect(observed).toEqual(
      new Map([
        ['first', { tenant: 'tenant-first', cookie: 'session=session-first' }],
        ['second', { tenant: 'tenant-second', cookie: 'session=session-second' }],
      ]),
    );
  });

  it('load errors retain framework status handling', async () => {
    const event = eventFixture({
      fetch: async () => new Response(null, { status: 204 }),
    });
    let redirectIdentity: unknown;
    const redirectLoad = createSvelteKitServerLoad({
      key: 'widget:redirect',
      createClient: createApiClient,
      clientOptions: { baseUrl: '/api' },
      load: () => {
        try {
          redirect(307, '/login');
        } catch (thrown) {
          redirectIdentity = thrown;
          throw thrown;
        }
      },
    });
    const redirectRejection = await rejectionOf(redirectLoad(event));
    expect(redirectRejection).toBe(redirectIdentity);
    expect(redirectRejection).toMatchObject({ status: 307, location: '/login' });

    let statusIdentity: unknown;
    const statusLoad = createSvelteKitServerLoad({
      key: 'widget:error',
      createClient: createApiClient,
      clientOptions: { baseUrl: '/api' },
      load: () => {
        try {
          error(418, { message: 'short teapot' });
        } catch (thrown) {
          statusIdentity = thrown;
          throw thrown;
        }
      },
    });
    const statusRejection = await rejectionOf(statusLoad(event));
    expect(statusRejection).toBe(statusIdentity);
    expect(statusRejection).toMatchObject({ status: 418, body: { message: 'short teapot' } });
  });

  it('passes the request signal to generated operations unchanged', async () => {
    const controller = new AbortController();
    const reason = Object.freeze({ kind: 'request-aborted' });
    const started = Promise.withResolvers<void>();
    const event = eventFixture({
      signal: controller.signal,
      fetch: async (_input, init) => {
        started.resolve();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      },
    });
    const load = createSvelteKitServerLoad({
      key: 'widget:abort',
      createClient: createApiClient,
      clientOptions: { baseUrl: '/api' },
      load: (client, _event, signal) => client.getWidget({ id: 'one' }, { signal }),
    });

    const operation = load(event);
    await started.promise;
    controller.abort(reason);
    await expect(operation).rejects.toBe(reason);
  });
});
