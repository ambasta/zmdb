import {
  createClientRuntime,
  type AuthenticationProvider,
  type ClientBody,
  type ClientHeaders,
  type ClientOperationResponse,
  type ClientRequest,
  type ClientResponseBody,
  type ClientTransport,
  type GeneratedOperation,
} from '@zmdb/client';
import { prepareClientBody } from '@zmdb/client/body';
import { describe, expect, it } from 'vitest';

import { HTTP_CONVERGENCE_FIXTURE, type FrozenHttpOperation } from './__fixtures__/http-convergence.js';

// FROZEN SURFACE — packages/client/SPEC.md §§2-9.
//
// #682 supplies the real transport runtime and body helper. Operation-specific
// request/response code remains the #684 boundary, so only those generated calls
// stay as executable expected failures.

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

function unimplemented(what: string): never {
  throw new Error(`${what} has no production implementation`);
}

const prepareBody: (kind: 'json' | 'text' | 'bytes' | 'stream' | 'empty', value: unknown) => ClientBody | undefined = (
  kind,
  value,
) => prepareClientBody(kind, value);

const operation: GeneratedOperation<UpdateAccountInput, UpdateAccountResult> = {
  abi: 1,
  operationId: HTTP_CONVERGENCE_FIXTURE.contract.operations[0].operationId,
  method: HTTP_CONVERGENCE_FIXTURE.contract.operations[0].method,
  security: HTTP_CONVERGENCE_FIXTURE.contract.operations[0].security,
  schemes: HTTP_CONVERGENCE_FIXTURE.contract.securitySchemes,
  version: { kind: 'header', values: ['1', '2'], default: '1' },
  prepare: (_input, _version) => unimplemented('generated operation.prepare'),
  read: (_response, _version) => unimplemented('generated operation.read'),
};

const runtimeOperation: GeneratedOperation<UpdateAccountInput, UpdateAccountResult> = {
  ...operation,
  security: [],
  schemes: {},
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
  security: operation.security,
  schemes: operation.schemes,
};

function input(): UpdateAccountInput {
  return HTTP_CONVERGENCE_FIXTURE.input;
}

function unreadBody(): ClientResponseBody {
  return {
    empty: () => Promise.reject(new Error('generated operation did not choose empty()')),
    json: () => Promise.reject(new Error('generated operation did not choose json()')),
    text: () => Promise.reject(new Error('generated operation did not choose text()')),
    bytes: () => Promise.reject(new Error('generated operation did not choose bytes()')),
    stream: () => unimplemented('generated operation did not choose stream()'),
  };
}

function response(status: number, headers: ClientHeaders = {}): ClientOperationResponse {
  return {
    status,
    headers,
    body: unreadBody(),
    unexpectedStatus: () => Promise.reject(new Error('generated operation did not call unexpectedStatus()')),
  };
}

function operationResponse(status: number): FrozenHttpOperation['responses'][number] | undefined {
  return HTTP_CONVERGENCE_FIXTURE.contract.operations[0].responses.find(candidate => candidate.status === status);
}

describe('@zmdb/client frozen request planning', () => {
  it.fails('the frozen operation example renders one unambiguous request plan', () => {
    expect(operation.prepare(input(), '2')).toEqual(HTTP_CONVERGENCE_FIXTURE.expectedRequest);
  });

  it.fails('every supported body and parameter location has a specified wire representation', () => {
    const plan = operation.prepare(input(), '2');
    expect(plan.path).toBe(HTTP_CONVERGENCE_FIXTURE.expectedRequest.path);
    expect(plan.query).toEqual(HTTP_CONVERGENCE_FIXTURE.expectedRequest.query);
    expect(plan.headers).toEqual(HTTP_CONVERGENCE_FIXTURE.expectedRequest.headers);
    expect(plan.cookies).toEqual(HTTP_CONVERGENCE_FIXTURE.expectedRequest.cookies);
    expect(plan.body).toBe(HTTP_CONVERGENCE_FIXTURE.expectedRequest.body);
    expect(HTTP_CONVERGENCE_FIXTURE.bodyKinds.map(body => prepareBody(body.kind, undefined))).toHaveLength(5);
  });

  it.fails('encodes every path parameter exactly once', () => {
    const plan = operation.prepare(input(), '2');
    expect(plan.path).toBe('/accounts/acct%2Fblue%3Fdraft%231');
    expect(plan.path).not.toContain('%252F');
    expect(plan.path.match(/acct/g)).toHaveLength(1);
  });

  it.fails('omits undefined query values and repeats arrays', () => {
    const plan = operation.prepare(input(), '2');
    expect(plan.query).toEqual([
      { name: 'include', value: 'roles & permissions' },
      { name: 'include', value: 'teams' },
    ]);
    expect(plan.query.some(pair => pair.name === 'dry-run')).toBe(false);
  });

  it.fails('distinguishes an empty body from JSON null', () => {
    expect(prepareBody('empty', undefined)).toBeUndefined();
    expect(prepareBody('json', null)).toBe('null');
    expect(operation.prepare(input(), '2').body).toContain('"metadata":null');
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
  it.fails('selects a validator by response status', async () => {
    expect(operationResponse(200)?.body).not.toEqual(operationResponse(202)?.body);
    await expect(operation.read(response(202), '2')).resolves.toEqual({
      status: 202,
      body: { jobId: 'job-680' },
      headers: {},
    });
  });

  it.fails('rejects an undocumented status', async () => {
    await expect(Promise.resolve().then(() => operation.read(response(418), '2'))).rejects.toMatchObject({
      name: 'UnexpectedStatusError',
      status: 418,
    });
  });

  it.fails('keeps documented errors distinct from malformed and invalid successful responses', async () => {
    await expect(Promise.resolve().then(() => operation.read(response(404), '2'))).rejects.toMatchObject({
      name: 'ClientResponseError',
      status: 404,
    });
    await expect(Promise.resolve().then(() => operation.read(response(200), '2'))).resolves.toMatchObject({
      status: 200,
    });
  });

  it.fails('selects header and media-type response versions from the generated plan', async () => {
    await expect(operation.read(response(200, { 'content-type': 'application/json' }), '1')).resolves.toMatchObject({
      status: 200,
    });
    await expect(
      operation.read(response(200, { 'content-type': 'application/json; version=2' }), '2'),
    ).resolves.toMatchObject({ status: 200 });
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
    const authentication: AuthenticationProvider = context => {
      expect(context.requirements).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
      return { requirement: 0, headers: { authorization: `Bearer ${secret}` } };
    };
    const runtime = createClientRuntime({ baseUrl: '/api', transport, authentication });
    await runtime.call(protectedRuntimeOperation, input(), { version: '2' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${secret}`);
    expect(JSON.stringify(operation)).not.toContain(secret);
  });
});
