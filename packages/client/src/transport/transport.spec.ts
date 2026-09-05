import { ClientRequestError, TransportError } from '@zmdb/client/errors';
import { createFetchTransport, type FetchLike } from '@zmdb/client/transport';
import { describe, expect, it } from 'vitest';

function request(
  overrides: Partial<Parameters<ReturnType<typeof createFetchTransport>>[0]> = {},
): Parameters<ReturnType<typeof createFetchTransport>>[0] {
  return {
    method: 'POST',
    url: 'https://api.example.test/widgets',
    headers: { accept: 'application/json' },
    ...overrides,
  };
}

describe('@zmdb/client Fetch transport', () => {
  it('passes the exact request with manual redirect handling', async () => {
    let input: RequestInfo | URL | undefined;
    let init: RequestInit | undefined;
    const fetch: FetchLike = async (nextInput, nextInit) => {
      input = nextInput;
      init = nextInit;
      return new Response('ok', { status: 202, headers: { 'X-Result': 'ready' } });
    };
    const transport = createFetchTransport(fetch);
    const body = 'payload';
    const response = await transport(request({ body }));

    expect(input).toBe('https://api.example.test/widgets');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
      redirect: 'manual',
    });
    expect(response.status).toBe(202);
    expect(response.headers).toEqual({ 'content-type': 'text/plain;charset=UTF-8', 'x-result': 'ready' });
    expect(response.body).toBeInstanceOf(ReadableStream);
  });

  it('passes a streaming body once with the platform streaming option', async () => {
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>();
    let observedBody: BodyInit | null | undefined;
    let duplex: unknown;
    const fetch: FetchLike = async (_input, init) => {
      observedBody = init?.body;
      duplex = init === undefined ? undefined : Reflect.get(init, 'duplex');
      return new Response(null, { status: 204 });
    };
    await createFetchTransport(fetch)(request({ body }));
    expect(observedBody).toBe(body);
    expect(duplex).toBe('half');
  });

  it('refuses explicit cookies before invoking Fetch', async () => {
    let called = false;
    const fetch: FetchLike = async () => {
      called = true;
      return new Response(null, { status: 204 });
    };
    await expect(
      createFetchTransport(fetch)(request({ headers: { cookie: 'session=secret' } })),
    ).rejects.toBeInstanceOf(ClientRequestError);
    expect(called).toBe(false);
  });

  it('wraps a non-abort rejection with the original cause', async () => {
    const cause = new Error('network down');
    const fetch: FetchLike = () => Promise.reject(cause);
    await expect(createFetchTransport(fetch)(request())).rejects.toMatchObject({
      name: 'TransportError',
      cause,
    });
  });

  it('propagates an aborted Fetch signal reason without wrapping it', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped');
    controller.abort(reason);
    const fetch: FetchLike = () => Promise.reject(new TypeError('fetch aborted'));
    await expect(createFetchTransport(fetch)(request({ signal: controller.signal }))).rejects.toBe(reason);
  });

  it('rejects an opaque redirect as a transport failure', async () => {
    const fetch: FetchLike = async () => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
      return response;
    };
    await expect(createFetchTransport(fetch)(request())).rejects.toBeInstanceOf(TransportError);
  });
});
