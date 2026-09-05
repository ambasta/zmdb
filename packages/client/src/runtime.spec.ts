import {
  CLIENT_RUNTIME_ABI,
  AuthenticationError,
  ClientRequestError,
  ClientResponseError,
  ClientTimeoutError,
  MissingAuthenticationError,
  ResponseDecodeError,
  ResponseTooLargeError,
  ResponseValidationError,
  TransportError,
  UnexpectedContentTypeError,
  UnexpectedStatusError,
  createClientRuntime,
  type ClientBytes,
  type ClientOperationResponse,
  type ClientRequest,
  type ClientResponse,
  type ClientTransport,
  type DecodeResult,
  type GeneratedOperation,
  type PreparedClientRequest,
} from '@zmdb/client';
import { describe, expect, it } from 'vitest';

interface Widget {
  readonly id: string;
}

interface OperationOptions {
  readonly operationId?: string;
  readonly method?: string;
  readonly prepare?: (input: unknown, version: string | undefined) => PreparedClientRequest;
  readonly read?: (response: ClientOperationResponse) => Promise<unknown>;
  readonly security?: GeneratedOperation<unknown, unknown>['security'];
  readonly schemes?: GeneratedOperation<unknown, unknown>['schemes'];
  readonly version?: GeneratedOperation<unknown, unknown>['version'];
}

const encoder = new TextEncoder();

function bytes(value: string): ClientBytes {
  return encoder.encode(value);
}

function body(...chunks: readonly ClientBytes[]): ReadableStream<ClientBytes> {
  return new ReadableStream<ClientBytes>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function jsonResponse(value: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): ClientResponse {
  return {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: body(bytes(JSON.stringify(value))),
  };
}

function decodeWidget(value: unknown): DecodeResult<Widget> {
  if (typeof value === 'object' && value !== null && typeof Reflect.get(value, 'id') === 'string') {
    return { ok: true, value: { id: Reflect.get(value, 'id') } };
  }
  return { ok: false, issues: [{ path: '$.id', message: 'expected string' }] };
}

function operation(options: OperationOptions = {}): GeneratedOperation<unknown, unknown> {
  return {
    abi: CLIENT_RUNTIME_ABI,
    operationId: options.operationId ?? 'get_widget',
    method: options.method ?? 'GET',
    security: options.security ?? [],
    schemes: options.schemes ?? {},
    version: options.version ?? { kind: 'none' },
    prepare:
      options.prepare ??
      (() => ({
        path: '/widgets/widget%2Fone',
        query: [{ name: 'include', value: 'roles & permissions' }],
        headers: { accept: 'application/json' },
        cookies: [],
      })),
    read: options.read ?? (async response => response.body.json('application/json', decodeWidget)),
  };
}

async function captureRequest(
  runtimeOperation: GeneratedOperation<unknown, unknown>,
  response: ClientResponse = jsonResponse({ id: 'widget/one' }),
  baseUrl: string | URL = '/api',
): Promise<{ readonly result: unknown; readonly request: ClientRequest }> {
  let request: ClientRequest | undefined;
  const transport: ClientTransport = async candidate => {
    request = candidate;
    return response;
  };
  const result = await createClientRuntime({ baseUrl, transport }).call(runtimeOperation, {});
  if (request === undefined) throw new Error('transport was not called');
  return { result, request };
}

describe('@zmdb/client runtime request execution', () => {
  it('uses an injected transport without global fetch', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Reflect.deleteProperty(globalThis, 'fetch');
    try {
      const captured = await captureRequest(operation());
      expect(captured.result).toEqual({ id: 'widget/one' });
      expect(captured.request.url).toBe('/api/widgets/widget%2Fone?include=roles%20%26%20permissions');
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'fetch', descriptor);
    }
  });

  it('keeps the generated path encoded and serialises unencoded query pairs', async () => {
    const captured = await captureRequest(operation(), jsonResponse({ id: 'widget/one' }), 'https://api.test/v1/');
    expect(captured.request.url).toBe('https://api.test/v1/widgets/widget%2Fone?include=roles%20%26%20permissions');
    expect(captured.request.url).not.toContain('%252F');
  });

  it('rejects an ABI mismatch before authentication or transport', async () => {
    let authenticated = false;
    let transported = false;
    const mismatched = { ...operation(), abi: 2 };
    const runtime = createClientRuntime({
      baseUrl: '/api',
      authentication: () => {
        authenticated = true;
        return { requirement: 0 };
      },
      transport: async () => {
        transported = true;
        return jsonResponse({ id: 'one' });
      },
    });
    await expect(Reflect.apply(runtime.call, runtime, [mismatched, {}])).rejects.toMatchObject({
      name: 'ClientRequestError',
    });
    expect(authenticated).toBe(false);
    expect(transported).toBe(false);
  });

  it('rejects transport-owned and contract-owned construction headers', () => {
    expect(() =>
      createClientRuntime({ baseUrl: '/api', headers: { host: 'api.test' }, transport: async () => jsonResponse({}) }),
    ).toThrow(/owned by the transport/u);
    expect(() =>
      createClientRuntime({
        baseUrl: '/api',
        headers: { accept: 'application/json' },
        transport: async () => jsonResponse({}),
      }),
    ).toThrow(/owned by the generated operation/u);
  });

  it('rejects conflicting headers and preserves identical values', async () => {
    await expect(
      captureRequest(
        operation({
          prepare: () => ({
            path: '/widgets',
            query: [],
            headers: { 'x-client': 'operation' },
            cookies: [],
          }),
        }),
        jsonResponse({ id: 'one' }),
      ),
    ).resolves.toMatchObject({ request: { headers: { 'x-client': 'operation' } } });

    const runtime = createClientRuntime({
      baseUrl: '/api',
      headers: { 'x-client': 'construction' },
      transport: async () => jsonResponse({ id: 'one' }),
    });
    await expect(
      runtime.call(
        operation({
          prepare: () => ({
            path: '/widgets',
            query: [],
            headers: { 'x-client': 'operation' },
            cookies: [],
          }),
        }),
        {},
      ),
    ).rejects.toBeInstanceOf(ClientRequestError);
  });

  it('selects and validates declared versions', async () => {
    let preparedVersion: string | undefined;
    const versioned = operation({
      version: { kind: 'header', values: ['1', '2'], default: '1' },
      prepare: (_input, version) => {
        preparedVersion = version;
        return {
          path: '/widgets',
          query: [],
          headers: { accept: 'application/json', 'accept-version': '2' },
          cookies: [],
        };
      },
    });
    const runtime = createClientRuntime({ baseUrl: '/api', transport: async () => jsonResponse({ id: 'one' }) });
    await runtime.call(versioned, {}, { version: '2' });
    expect(preparedVersion).toBe('2');
    await expect(runtime.call(versioned, {}, { version: '3' })).rejects.toBeInstanceOf(ClientRequestError);
    await expect(runtime.call(operation(), {}, { version: '1' })).rejects.toBeInstanceOf(ClientRequestError);
  });
});

describe('@zmdb/client cancellation and transport failures', () => {
  it('propagates the exact abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped request');
    let transportSignal: AbortSignal | undefined;
    const transport: ClientTransport = request => {
      transportSignal = request.signal;
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
      });
    };
    const pending = createClientRuntime({ baseUrl: '/api', transport }).call(
      operation(),
      {},
      {
        signal: controller.signal,
      },
    );
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(transportSignal?.reason).toBe(reason);
  });

  it('does not call authentication or transport for an already-aborted signal', async () => {
    const controller = new AbortController();
    const reason = new Error('already stopped');
    controller.abort(reason);
    let called = false;
    const pending = createClientRuntime({
      baseUrl: '/api',
      transport: async () => {
        called = true;
        return jsonResponse({});
      },
    }).call(operation(), {}, { signal: controller.signal });
    await expect(pending).rejects.toBe(reason);
    expect(called).toBe(false);
  });

  it('uses one timeout error as the transport abort reason and rejection', async () => {
    let signal: AbortSignal | undefined;
    const pending = createClientRuntime({
      baseUrl: '/api',
      transport: request => {
        signal = request.signal;
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
        });
      },
    }).call(operation(), {}, { timeoutMs: 5 });
    const error = await pending.catch(reason => reason);
    expect(error).toBeInstanceOf(ClientTimeoutError);
    expect(signal?.reason).toBe(error);
  });

  it('cancels a pending buffered body read with the exact caller reason', async () => {
    const controller = new AbortController();
    const reason = new Error('stop reading response');
    let started: (() => void) | undefined;
    const reading = new Promise<void>(resolve => {
      started = resolve;
    });
    let cancelledWith: unknown;
    const responseBody = new ReadableStream<ClientBytes>(
      {
        pull() {
          started?.();
        },
        cancel(reason_) {
          cancelledWith = reason_;
        },
      },
      { highWaterMark: 0 },
    );
    const pending = createClientRuntime({
      baseUrl: '/api',
      transport: async () => ({
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: responseBody,
      }),
    }).call(operation({ read: response => response.body.text('text/plain') }), {}, { signal: controller.signal });
    await reading;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(cancelledWith).toBe(reason);
  });

  it('wraps custom transport failures with the original cause', async () => {
    const cause = new Error('network down');
    const pending = createClientRuntime({
      baseUrl: '/api',
      transport: () => Promise.reject(cause),
    }).call(operation(), {});
    await expect(pending).rejects.toMatchObject({ name: 'TransportError', operationId: 'get_widget', cause });
  });

  it('keeps caller abort, timeout, and transport failure distinct', () => {
    expect(new ClientTimeoutError('get_widget', 10)).not.toBeInstanceOf(TransportError);
    expect(new TransportError('get_widget', new Error('down'))).not.toBeInstanceOf(ClientTimeoutError);
  });
});

describe('@zmdb/client response protocol', () => {
  it('bounds an error body before including it in an exception', async () => {
    let cancelled = false;
    const oversized = new ReadableStream<ClientBytes>({
      pull(controller) {
        controller.enqueue(bytes('0123456789'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const runtime = createClientRuntime({
      baseUrl: '/api',
      maxErrorBodyBytes: 4,
      transport: async () => ({ status: 418, headers: { 'content-type': 'text/plain' }, body: oversized }),
    });
    const pending = runtime.call(operation({ read: response => response.unexpectedStatus() }), {});
    await expect(pending).rejects.toMatchObject({
      name: 'UnexpectedStatusError',
      status: 418,
      bodySnippet: '0123',
    });
    expect(cancelled).toBe(true);
  });

  it('rejects a declared content length before reading the body', async () => {
    let pulled = false;
    let cancelled = false;
    const stream = new ReadableStream<ClientBytes>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(bytes('too large'));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const pending = createClientRuntime({
      baseUrl: '/api',
      maxResponseBytes: 4,
      transport: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '9' },
        body: stream,
      }),
    }).call(operation(), {});
    await expect(pending).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
  });

  it('rejects a body that crosses the response limit while reading', async () => {
    const pending = createClientRuntime({
      baseUrl: '/api',
      maxResponseBytes: 4,
      transport: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: body(bytes('{"id":"too-large"}')),
      }),
    }).call(operation(), {});
    await expect(pending).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('distinguishes wrong media type, malformed JSON, and invalid decoded values', async () => {
    const runtime = (response: ClientResponse) =>
      createClientRuntime({ baseUrl: '/api', transport: async () => response }).call(operation(), {});

    await expect(
      runtime({ status: 200, headers: { 'content-type': 'text/plain' }, body: body(bytes('{}')) }),
    ).rejects.toBeInstanceOf(UnexpectedContentTypeError);
    await expect(
      runtime({ status: 200, headers: { 'content-type': 'application/json' }, body: body(bytes('{')) }),
    ).rejects.toBeInstanceOf(ResponseDecodeError);
    await expect(runtime(jsonResponse({ id: 1 }))).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it('rejects malformed UTF-8 rather than replacing it', async () => {
    const malformed = Uint8Array.of(0xc3, 0x28);
    const pending = createClientRuntime({
      baseUrl: '/api',
      transport: async () => ({
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: body(malformed),
      }),
    }).call(operation({ read: response => response.body.text('text/plain') }), {});
    await expect(pending).rejects.toBeInstanceOf(ResponseDecodeError);
  });

  it('cancels bodies that empty statuses are not allowed to expose', async () => {
    let cancelled = false;
    const stream = new ReadableStream<ClientBytes>({
      start(controller) {
        controller.enqueue(bytes('ignored'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await createClientRuntime({
      baseUrl: '/api',
      transport: async () => ({ status: 204, headers: {}, body: stream }),
    }).call(operation({ read: async response => response.body.empty() }), {});
    expect(result).toBeUndefined();
    expect(cancelled).toBe(true);
  });

  it('transfers a response stream without buffering it', async () => {
    const stream = body(bytes('first'), bytes('second'));
    const result = await createClientRuntime({
      baseUrl: '/api',
      maxResponseBytes: 1,
      transport: async () => ({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: stream }),
    }).call(operation({ read: async response => response.body.stream('application/octet-stream') }), {});
    expect(result).toBe(stream);
  });

  it('constructs documented response errors without erasing typed data', () => {
    const error = new ClientResponseError('get_widget', 404, { code: 'missing' }, { 'x-trace': 'one' });
    expect(error).toMatchObject({
      name: 'ClientResponseError',
      status: 404,
      body: { code: 'missing' },
      headers: { 'x-trace': 'one' },
    });
  });

  it('keeps undocumented status data bounded and structured', () => {
    const error = new UnexpectedStatusError('get_widget', 418, { 'x-trace': 'one' }, 'short');
    expect(error).toMatchObject({
      operationId: 'get_widget',
      status: 418,
      headers: { 'x-trace': 'one' },
      bodySnippet: 'short',
    });
  });
});

describe('@zmdb/client authentication', () => {
  const protectedOperation = (): GeneratedOperation<unknown, unknown> =>
    operation({
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      schemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        apiKeyAuth: { type: 'apiKey', in: 'query', name: 'api_key' },
      },
    });

  it('does not call an authentication provider for a public operation', async () => {
    let calls = 0;
    await createClientRuntime({
      baseUrl: '/api',
      authentication: () => {
        calls++;
        return { requirement: 0 };
      },
      transport: async () => jsonResponse({ id: 'one' }),
    }).call(operation(), {});
    expect(calls).toBe(0);
  });

  it('requires credentials for a protected operation', async () => {
    const pending = createClientRuntime({
      baseUrl: '/api',
      transport: async () => jsonResponse({ id: 'one' }),
    }).call(protectedOperation(), {});
    await expect(pending).rejects.toBeInstanceOf(MissingAuthenticationError);
  });

  it('injects exactly one declared alternative per request', async () => {
    let request: ClientRequest | undefined;
    const runtime = createClientRuntime({
      baseUrl: '/api',
      authentication: context => {
        expect(context.requirements).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
        return { requirement: 1, query: { api_key: 'request-secret' } };
      },
      transport: async candidate => {
        request = candidate;
        return jsonResponse({ id: 'one' });
      },
    });
    await runtime.call(protectedOperation(), {});
    expect(request?.url).toContain('api_key=request-secret');
    expect(request?.headers.authorization).toBeUndefined();
  });

  it('prefers a per-call provider and does not retain credentials in errors', async () => {
    const secret = 'credential-visible-only-in-request';
    let request: ClientRequest | undefined;
    const runtime = createClientRuntime({
      baseUrl: '/api',
      authentication: () => ({ requirement: 1, query: { api_key: 'configured' } }),
      transport: async candidate => {
        request = candidate;
        return { status: 418, headers: {}, body: null };
      },
    });
    const pending = runtime.call(
      protectedOperation(),
      {},
      {
        authentication: () => ({ requirement: 0, headers: { authorization: `Bearer ${secret}` } }),
      },
    );
    const error = await pending.catch(reason => reason);
    expect(request?.headers.authorization).toBe(`Bearer ${secret}`);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('wraps provider failures without swallowing their cause', async () => {
    const cause = new Error('credential store unavailable');
    const pending = createClientRuntime({
      baseUrl: '/api',
      authentication: () => Promise.reject(cause),
      transport: async () => jsonResponse({ id: 'one' }),
    }).call(protectedOperation(), {});
    await expect(pending).rejects.toMatchObject({ name: 'AuthenticationError', cause });
    await expect(pending).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects extra or misplaced authentication material', async () => {
    const runtime = createClientRuntime({
      baseUrl: '/api',
      authentication: () => ({ requirement: 0, headers: { authorization: 'Bearer one', 'x-extra': 'no' } }),
      transport: async () => jsonResponse({ id: 'one' }),
    });
    await expect(runtime.call(protectedOperation(), {})).rejects.toBeInstanceOf(ClientRequestError);
  });
});
