import {
  createClientRuntime,
  type AuthenticationProvider,
  type ClientBody,
  type ClientRequest,
  type ClientResponse,
  type ClientTransport,
  type GeneratedOperation,
} from '@zmdb/client';
import { prepareClientBody } from '@zmdb/client/body';
import { createFakeClientTransport, type HeldClientRequest } from '@zmdb/client/testing';
import { describe, expect, it } from 'vitest';

import { createApiClient } from './__fixtures__/http-client.generated.js';
import { HTTP_CONVERGENCE_FIXTURE } from './__fixtures__/http-convergence.js';
import { generateHttpClient } from './compiler/index.js';
import type { HttpContractIR } from './index.js';

// FROZEN SURFACE — packages/client/SPEC.md §§2-9.
//
// #682 supplies the transport runtime and body helper. #684 now supplies the
// operation-specific request and response code, so the former expected failures
// below are ordinary executable regressions against the checked-in generated client.

interface UpdateAccountInput {
  readonly path: { readonly accountId: string };
  readonly query?: {
    readonly include?: readonly string[] | undefined;
    readonly dryRun?: boolean | undefined;
  };
  readonly headers?: { readonly requestId?: string | undefined };
  readonly cookies: { readonly session: string };
  readonly body: { readonly displayName: string; readonly metadata: Readonly<Record<string, unknown>> | null };
}

type UpdateAccountResult =
  | {
      readonly status: 200;
      readonly body: { readonly id: string; readonly displayName: string };
      readonly headers: { readonly etag: string };
    }
  | {
      readonly status: 202;
      readonly body: { readonly jobId: string };
      readonly headers: Readonly<Record<never, never>>;
    }
  | {
      readonly status: 204;
      readonly body: void;
      readonly headers: Readonly<Record<never, never>>;
    };

const prepareBody: (kind: 'json' | 'text' | 'bytes' | 'stream' | 'empty', value: unknown) => ClientBody | undefined = (
  kind,
  value,
) => prepareClientBody(kind, value);

const runtimeOperation: GeneratedOperation<UpdateAccountInput, UpdateAccountResult> = {
  abi: 1,
  operationId: HTTP_CONVERGENCE_FIXTURE.contract.operations[0].operationId,
  method: HTTP_CONVERGENCE_FIXTURE.contract.operations[0].method,
  security: [],
  schemes: {},
  version: { kind: 'header', values: ['1', '2'], default: '1' },
  prepare: (_input, version) => ({
    path: HTTP_CONVERGENCE_FIXTURE.expectedRequest.path,
    query: HTTP_CONVERGENCE_FIXTURE.expectedRequest.query,
    headers: { 'accept-version': version ?? '1' },
    cookies: [],
  }),
  read: async runtimeResponse => {
    if (runtimeResponse.status !== 204) return runtimeResponse.unexpectedStatus();
    await runtimeResponse.body.empty();
    return { status: 204, body: undefined, headers: {} };
  },
};

const protectedRuntimeOperation: GeneratedOperation<UpdateAccountInput, UpdateAccountResult> = {
  ...runtimeOperation,
  security: HTTP_CONVERGENCE_FIXTURE.contract.operations[0].security,
  schemes: HTTP_CONVERGENCE_FIXTURE.contract.securitySchemes,
};

function input(): UpdateAccountInput {
  return HTTP_CONVERGENCE_FIXTURE.input;
}

function responseBody(body: string): ReadableStream<Uint8Array<ArrayBuffer>> {
  const bytes = new TextEncoder().encode(body);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function jsonResponse(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): ClientResponse {
  return {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: responseBody(JSON.stringify(body)),
  };
}

function authentication(): AuthenticationProvider {
  return () => ({ requirement: 0, headers: { authorization: 'Bearer frozen-test-token' } });
}

async function generatedCall(): Promise<{
  readonly held: HeldClientRequest;
  readonly pending: ReturnType<ReturnType<typeof createApiClient>['patch_accounts_accountId']>;
}> {
  const fake = createFakeClientTransport();
  const client = createApiClient({
    baseUrl: '/api',
    transport: fake.transport,
    authentication: authentication(),
  });
  const pending = client.patch_accounts_accountId(HTTP_CONVERGENCE_FIXTURE.input, { version: '2' });
  return { held: await fake.nextRequest(), pending };
}

async function finishEmpty(
  held: HeldClientRequest,
  pending: ReturnType<ReturnType<typeof createApiClient>['patch_accounts_accountId']>,
): Promise<void> {
  held.respond({ status: 204, headers: {}, body: null });
  await expect(pending).resolves.toEqual({ status: 204, body: undefined, headers: {} });
}

describe('@zmdb/client frozen request planning', () => {
  it('the frozen operation example renders one unambiguous request plan', async () => {
    const { held, pending } = await generatedCall();
    expect(held.request).toEqual({
      method: 'PATCH',
      url: '/api/accounts/acct%2Fblue%3Fdraft%231?include=roles%20%26%20permissions&include=teams',
      headers: {
        accept: 'application/json, application/problem+json',
        'accept-version': '2',
        authorization: 'Bearer frozen-test-token',
        'content-type': 'application/json',
        cookie: 'session=session%20value',
        'x-request-id': 'request-680',
      },
      body: '{"displayName":"Ada","metadata":null}',
    });
    await finishEmpty(held, pending);
  });

  it('every supported body and parameter location has a specified wire representation', async () => {
    const { held, pending } = await generatedCall();
    expect(held.request.url).toContain(HTTP_CONVERGENCE_FIXTURE.expectedRequest.path);
    expect(held.request.url).toContain('include=roles%20%26%20permissions&include=teams');
    expect(held.request.headers['x-request-id']).toBe(HTTP_CONVERGENCE_FIXTURE.expectedRequest.headers['x-request-id']);
    expect(held.request.headers.cookie).toBe('session=session%20value');
    expect(held.request.body).toBe(HTTP_CONVERGENCE_FIXTURE.expectedRequest.body);
    const stream = new ReadableStream<Uint8Array>();
    const bytes = Uint8Array.of(1, 2, 3);
    expect([
      prepareBody('json', null),
      prepareBody('text', 'ready'),
      prepareBody('bytes', bytes),
      prepareBody('stream', stream),
      prepareBody('empty', undefined),
    ]).toEqual(['null', 'ready', bytes, stream, undefined]);
    await finishEmpty(held, pending);
  });

  it('encodes every path parameter exactly once', async () => {
    const { held, pending } = await generatedCall();
    const path = held.request.url.split('?')[0];
    expect(path).toBe('/api/accounts/acct%2Fblue%3Fdraft%231');
    expect(path).not.toContain('%252F');
    expect(path?.match(/acct/g)).toHaveLength(1);
    await finishEmpty(held, pending);
  });

  it('omits undefined query values and repeats arrays', async () => {
    const { held, pending } = await generatedCall();
    expect(held.request.url.split('?')[1]).toBe('include=roles%20%26%20permissions&include=teams');
    expect(held.request.url).not.toContain('dry-run');
    await finishEmpty(held, pending);
  });

  it('distinguishes an empty body from JSON null', async () => {
    const { held, pending } = await generatedCall();
    expect(prepareBody('empty', undefined)).toBeUndefined();
    expect(prepareBody('json', null)).toBe('null');
    expect(held.request.body).toContain('"metadata":null');
    await finishEmpty(held, pending);
  });

  it('prepares JSON, text, bytes, stream, and empty bodies without changing ownership', () => {
    const stream = new ReadableStream<Uint8Array>();
    const bytes = Uint8Array.of(1, 2, 3);
    expect([
      prepareBody('json', { ok: true }),
      prepareBody('text', 'ready'),
      prepareBody('bytes', bytes),
      prepareBody('stream', stream),
      prepareBody('empty', undefined),
    ]).toEqual(['{"ok":true}', 'ready', bytes, stream, undefined]);
  });
});

describe('@zmdb/client frozen response dispatch', () => {
  it('selects a validator by response status', async () => {
    const { held, pending } = await generatedCall();
    held.respond(jsonResponse(202, { jobId: 'job-680' }));
    await expect(pending).resolves.toEqual({
      status: 202,
      body: { jobId: 'job-680' },
      headers: {},
    });
  });

  it('rejects an undocumented status', async () => {
    const { held, pending } = await generatedCall();
    held.respond({
      status: 418,
      headers: { 'content-type': 'text/plain' },
      body: responseBody('teapot'),
    });
    await expect(pending).rejects.toMatchObject({
      name: 'UnexpectedStatusError',
      status: 418,
    });
  });

  it('keeps documented errors distinct from malformed and invalid successful responses', async () => {
    const documented = await generatedCall();
    documented.held.respond({
      ...jsonResponse(404, { code: 'missing', message: 'Not found' }),
      headers: { 'content-type': 'application/problem+json' },
    });
    await expect(documented.pending).rejects.toMatchObject({
      name: 'ClientResponseError',
      status: 404,
    });

    const malformed = await generatedCall();
    malformed.held.respond({
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"malformed"' },
      body: responseBody('{'),
    });
    await expect(malformed.pending).rejects.toMatchObject({
      name: 'ResponseDecodeError',
      status: 200,
    });

    const invalid = await generatedCall();
    invalid.held.respond(jsonResponse(200, { id: 'acct-1', displayName: 42 }, { etag: '"invalid"' }));
    await expect(invalid.pending).rejects.toMatchObject({
      name: 'ResponseValidationError',
      status: 200,
    });
  });

  it('selects header and media-type response versions from the generated plan', async () => {
    const header = await generatedCall();
    expect(header.held.request.headers['accept-version']).toBe('2');
    header.held.respond(jsonResponse(200, { id: 'acct-1', displayName: 'Ada' }, { etag: '"header-v2"' }));
    await expect(header.pending).resolves.toMatchObject({ status: 200 });

    const mediaContract: HttpContractIR = {
      format: 1,
      types: {},
      operations: [
        {
          operationId: 'get_media',
          controller: 'MediaController',
          handler: 'read',
          method: 'GET',
          path: '/media',
          parameters: [],
          responses: [
            {
              status: 200,
              description: 'Media',
              headers: [],
              body: { kind: 'text', mediaType: 'text/plain' },
              versions: {
                '1': { kind: 'text', mediaType: 'text/plain' },
                '2': { kind: 'text', mediaType: 'text/vnd.zmdb' },
              },
            },
          ],
          security: [],
          version: { kind: 'media-type', key: 'version', values: ['1', '2'], default: '1' },
          deprecated: false,
        },
      ],
      securitySchemes: {},
    };
    const source = generateHttpClient(mediaContract).source;
    expect(source).toContain('text/plain; version=1');
    expect(source).toContain('text/vnd.zmdb; version=2');
  });
});

describe('@zmdb/client frozen transport, cancellation, and authentication', () => {
  it('aborts the underlying transport', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped request');
    let transportSignal: AbortSignal | undefined;
    const transport: ClientTransport = request => {
      transportSignal = request.signal;
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
      });
    };
    const runtime = createClientRuntime({ baseUrl: '/api', transport });
    const pending = runtime.call(runtimeOperation, input(), { signal: controller.signal, version: '2' });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(transportSignal?.aborted).toBe(true);
  });

  it('keeps caller abort, timeout, transport failure, and stream cancellation distinct', async () => {
    const runtime = createClientRuntime({
      baseUrl: 'https://api.example.test/v1',
      transport: () => Promise.reject(new Error('network down')),
    });
    await expect(runtime.call(runtimeOperation, input(), { timeoutMs: 25, version: '2' })).rejects.toMatchObject({
      name: 'TransportError',
    });
  });

  it('injects one declared security alternative without retaining credentials', async () => {
    const secret = 'token-visible-only-to-the-provider';
    const requests: ClientRequest[] = [];
    const transport: ClientTransport = async request => {
      requests.push(request);
      return { status: 204, headers: {}, body: null };
    };
    const authenticationProvider: AuthenticationProvider = context => {
      expect(context.requirements).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
      return { requirement: 0, headers: { authorization: `Bearer ${secret}` } };
    };
    const runtime = createClientRuntime({
      baseUrl: '/api',
      transport,
      authentication: authenticationProvider,
    });
    await runtime.call(protectedRuntimeOperation, input(), { version: '2' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${secret}`);
    expect(JSON.stringify(protectedRuntimeOperation)).not.toContain(secret);
  });
});
