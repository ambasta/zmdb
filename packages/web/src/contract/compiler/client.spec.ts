import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AuthenticationProvider, ClientResponse } from '@zmdb/client';
import { createFakeClientTransport, type HeldClientRequest } from '@zmdb/client/testing';
import type { TypeIR } from '@zmdb/schema-core/ir';
import { describe, expect, it } from 'vitest';

import { createApiClient, isPatchAccountsAccountIdError } from '../__fixtures__/http-client.generated.js';
import { HTTP_CONVERGENCE_FIXTURE } from '../__fixtures__/http-convergence.js';
import type { HttpContractIR } from '../index.js';
import { generateHttpClient, HTTP_CLIENT_GENERATOR_VERSION } from './client.js';

const GENERATED = fileURLToPath(new URL('../__fixtures__/http-client.generated.ts', import.meta.url));
const GENERATED_MAP = fileURLToPath(new URL('../__fixtures__/http-client.generated.ts.map', import.meta.url));

function generated() {
  return generateHttpClient(HTTP_CONVERGENCE_FIXTURE.contract);
}

function contract(operations: HttpContractIR['operations'], types: HttpContractIR['types'] = {}): HttpContractIR {
  return { format: 1, types, operations, securitySchemes: {} };
}

function operation(
  operationId: string,
  responses: HttpContractIR['operations'][number]['responses'],
): HttpContractIR['operations'][number] {
  return {
    operationId,
    controller: 'FixtureController',
    handler: operationId,
    method: 'GET',
    path: `/${operationId}`,
    parameters: [],
    responses,
    security: [],
    version: { kind: 'none' },
    deprecated: false,
  };
}

function jsonType(type: TypeIR): HttpContractIR['types'][string] {
  return { type, openApi: {} };
}

function authentication(): AuthenticationProvider {
  return () => ({ requirement: 0, headers: { authorization: 'Bearer runtime-only-test-token' } });
}

function jsonResponse(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): ClientResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
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

describe('HttpContractIR typed-client generation', () => {
  it('generates exact request and response types', () => {
    const source = generated().source;
    expect(source).toContain('readonly path: { readonly accountId: PatchAccountsAccountIdPathAccountId; };');
    expect(source).toContain(
      'readonly query?: { readonly include?: PatchAccountsAccountIdQueryInclude | undefined; ' +
        'readonly dryRun?: PatchAccountsAccountIdQueryDryRun | undefined; };',
    );
    expect(source).toContain('export type PatchAccountsAccountIdResult = { readonly status: 200;');
    expect(source).toContain('ClientResponseError<404, PatchAccountsAccountIdResponse404Response404Body');
    expect(source).toContain('/** @deprecated */');
  });

  it('emits no TypeIR or JSON Schema walker', () => {
    const source = generated().source;
    expect(source).not.toMatch(/\bTypeIR\b|jsonSchema|openApi|schema\.kind|node\.kind/u);
    expect(source).toContain('_zmdbClientCheckAccount');
    expect(source).toContain('_zmdbClientIssuesAccount');
  });

  it('validates a successful response', async () => {
    const { held, pending } = await generatedCall();
    expect(held.request).toEqual({
      method: 'PATCH',
      url: '/api/accounts/acct%2Fblue%3Fdraft%231?include=roles%20%26%20permissions&include=teams',
      headers: {
        accept: 'application/json, application/problem+json',
        'accept-version': '2',
        authorization: 'Bearer runtime-only-test-token',
        'content-type': 'application/json',
        cookie: 'session=session%20value',
        'x-request-id': 'request-680',
      },
      body: '{"displayName":"Ada","metadata":null}',
    });
    held.respond(jsonResponse(200, { id: 'acct-1', displayName: 'Ada' }, { etag: '"account-1"' }));
    await expect(pending).resolves.toEqual({
      status: 200,
      body: { id: 'acct-1', displayName: 'Ada' },
      headers: { etag: '"account-1"' },
    });
  });

  it('rejects a malformed successful response', async () => {
    const { held, pending } = await generatedCall();
    held.respond(jsonResponse(200, { id: 'acct-1', displayName: 42 }, { etag: '"account-1"' }));
    await expect(pending).rejects.toMatchObject({
      name: 'ResponseValidationError',
      operationId: 'patch_accounts_accountId',
      status: 200,
      issues: [{ path: 'input.displayName', message: 'expected string' }],
    });
  });

  it('returns a typed alternate status', async () => {
    const { held, pending } = await generatedCall();
    held.respond(jsonResponse(202, { jobId: 'job-684' }));
    await expect(pending).resolves.toEqual({
      status: 202,
      body: { jobId: 'job-684' },
      headers: {},
    });
  });

  it('keeps documented errors typed and distinguishable', async () => {
    const { held, pending } = await generatedCall();
    held.respond({
      ...jsonResponse(404, { code: 'missing', message: 'Account not found' }),
      headers: { 'content-type': 'application/problem+json' },
    });
    try {
      await pending;
      throw new Error('documented error unexpectedly resolved');
    } catch (error) {
      expect(isPatchAccountsAccountIdError(error)).toBe(true);
      expect(error).toMatchObject({
        name: 'ClientResponseError',
        operationId: 'patch_accounts_accountId',
        status: 404,
        body: { code: 'missing', message: 'Account not found' },
      });
    }
  });

  it('emits byte-identically twice', () => {
    const first = generated();
    const second = generated();
    expect(second.source).toBe(first.source);
    expect(second.sourceMap).toBe(first.sourceMap);
    expect(first).toMatchObject({
      contractFormat: 1,
      generatorVersion: HTTP_CLIENT_GENERATOR_VERSION,
      operations: ['patch_accounts_accountId'],
    });
  });

  it('renaming one route changes only its operation', () => {
    const unchanged = operation('get_health', [
      { status: 204, description: 'Healthy', headers: [], body: { kind: 'empty' } },
    ]);
    const canonicalOperation = HTTP_CONVERGENCE_FIXTURE.contract.operations[0];
    const beforeContract: HttpContractIR = {
      ...HTTP_CONVERGENCE_FIXTURE.contract,
      operations: [canonicalOperation, unchanged],
    };
    const afterContract: HttpContractIR = {
      ...beforeContract,
      operations: [{ ...canonicalOperation, path: '/accounts/:accountId/profile' }, unchanged],
    };
    const before = generateHttpClient(beforeContract).source;
    const after = generateHttpClient(afterContract).source;
    expect(after).not.toBe(before);
    expect(after.replace('/accounts/:accountId/profile', '/accounts/:accountId')).toBe(before);
    const unchangedBlock = /\/\/ operation get_health[\s\S]*?\/\/ end operation get_health/u;
    expect(after.match(unchangedBlock)?.[0]).toBe(before.match(unchangedBlock)?.[0]);
  });

  it('generated source imports only @zmdb/client', () => {
    const source = generated().source;
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/gu)].map(match => match[1]);
    expect(imports).toEqual(['@zmdb/client', '@zmdb/client']);
    expect(source).not.toMatch(/@zmdb\/(?:web|aot-validator|schema-core)|node:/u);
  });

  it('emits a stable path-independent source map', () => {
    const output = generated();
    const map = JSON.parse(output.sourceMap);
    expect(map).toMatchObject({
      version: 3,
      file: 'http-client.generated.ts',
      sources: ['zmdb:http-contract'],
      names: [],
    });
    expect(output.sourceMap).not.toContain(process.cwd());
    expect(output.sourceMap).not.toContain('/home/');
    expect(map.sourcesContent[0]).not.toContain('openApi');
  });

  it('ignores unknown credential and workspace fields', () => {
    const tainted = {
      ...HTTP_CONVERGENCE_FIXTURE.contract,
      credential: 'credential-must-never-enter-generated-output',
      workspacePath: process.cwd(),
    };
    const output = generateHttpClient(tainted);
    expect(output.source).not.toContain(tainted.credential);
    expect(output.sourceMap).not.toContain(tainted.credential);
    expect(output.sourceMap).not.toContain(tainted.workspacePath);
  });

  it('refuses unsupported contracts explicitly', () => {
    const typeId = 'patch_accounts_accountId/response/200/body';
    const unsupported: HttpContractIR = {
      ...HTTP_CONVERGENCE_FIXTURE.contract,
      types: {
        ...HTTP_CONVERGENCE_FIXTURE.contract.types,
        [typeId]: {
          type: { kind: 'unsupported', reason: 'conditional response type is not representable' },
          openApi: {},
        },
      },
    };
    expect(() => generateHttpClient(unsupported)).toThrow(/conditional response type is not representable/u);
    expect(() =>
      Reflect.apply(generateHttpClient, undefined, [{ openapi: '3.1.0', paths: {}, components: {} }]),
    ).toThrow(/expected HttpContractIR format 1/u);
  });

  it('emits exact media-type overloads and validates the selected representation', () => {
    const mediaContract = contract(
      [
        {
          ...operation('get_media', []),
          responses: [
            {
              status: 200,
              description: 'Versioned',
              headers: [],
              body: { kind: 'json', mediaType: 'application/json', typeId: 'media/v1' },
              versions: {
                '1': { kind: 'json', mediaType: 'application/json', typeId: 'media/v1' },
                '2': {
                  kind: 'json',
                  mediaType: 'application/vnd.zmdb+json',
                  typeId: 'media/v2',
                },
              },
            },
          ],
          version: { kind: 'media-type', key: 'version', values: ['1', '2'], default: '1' },
        },
      ],
      {
        'media/v1': jsonType({
          kind: 'object',
          properties: [
            {
              name: 'version',
              type: { kind: 'literal', value: 1 },
              optional: false,
              readonly: true,
            },
          ],
        }),
        'media/v2': jsonType({
          kind: 'object',
          properties: [
            {
              name: 'version',
              type: { kind: 'literal', value: 2 },
              optional: false,
              readonly: true,
            },
            {
              name: 'label',
              type: { kind: 'scalar', scalar: 'string' },
              optional: false,
              readonly: true,
            },
          ],
        }),
      },
    );
    const source = generateHttpClient(mediaContract).source;
    expect(source).toContain(
      'get_media(input: GetMediaInput, options: CallOptions & { readonly version: "2" }): ' +
        'Promise<GetMediaResultVValue2>;',
    );
    expect(source).toContain(
      'get_media(input: GetMediaInput, options?: CallOptions & { readonly version?: "1" }): ' +
        'Promise<GetMediaResultVValue1>;',
    );
    expect(source).toContain('application/json; version=1');
    expect(source).toContain('application/vnd.zmdb+json; version=2');
    expect(source).toContain('if (version === "2")');
  });

  it('emits all fixed body kinds and omits content-type with an omitted optional body', () => {
    const bodies = contract([
      {
        ...operation('post_text', [
          {
            status: 200,
            description: 'Text',
            headers: [],
            body: { kind: 'text', mediaType: 'text/plain' },
          },
        ]),
        method: 'POST',
        requestBody: { kind: 'text', mediaType: 'text/plain', required: false },
      },
      {
        ...operation('post_bytes', [
          {
            status: 200,
            description: 'Bytes',
            headers: [],
            body: { kind: 'bytes', mediaType: 'application/octet-stream' },
          },
        ]),
        method: 'POST',
        requestBody: {
          kind: 'bytes',
          mediaType: 'application/octet-stream',
          required: true,
        },
      },
      {
        ...operation('post_stream', [
          {
            status: 200,
            description: 'Stream',
            headers: [],
            body: { kind: 'stream', mediaType: 'application/x-ndjson' },
          },
        ]),
        method: 'POST',
        requestBody: {
          kind: 'stream',
          mediaType: 'application/x-ndjson',
          required: true,
        },
      },
      operation('get_empty', [{ status: 204, description: 'Empty', headers: [], body: { kind: 'empty' } }]),
    ]);
    const source = generateHttpClient(bodies).source;
    expect(source).toContain('export interface PostTextInput { readonly body?: string | undefined; }');
    expect(source).toContain('if (body !== undefined) headers[\'content-type\'] = "text/plain";');
    expect(source).toContain('readonly body: Uint8Array<ArrayBuffer>;');
    expect(source).toContain('readonly body: ReadableStream<Uint8Array<ArrayBuffer>>;');
    expect(source).toContain('response.body.text("text/plain")');
    expect(source).toContain('response.body.bytes("application/octet-stream")');
    expect(source).toContain('response.body.stream("application/x-ndjson")');
    expect(source).toContain('await response.body.empty()');
  });

  it('emits bracket access for non-identifier contract properties', () => {
    const quoted = contract(
      [
        {
          ...operation('get_quoted', [{ status: 204, description: 'Done', headers: [], body: { kind: 'empty' } }]),
          path: '/quoted/:accountId',
          parameters: [
            {
              property: 'account-id',
              name: 'accountId',
              in: 'path',
              required: true,
              typeId: 'quoted/path',
            },
          ],
        },
      ],
      { 'quoted/path': jsonType({ kind: 'scalar', scalar: 'string' }) },
    );
    const source = generateHttpClient(quoted).source;
    expect(source).toContain('readonly "account-id": GetQuotedPathAccountId;');
    expect(source).toContain('input.path["account-id"]');
    expect(source).not.toContain('input.path."account-id"');
  });

  it('refuses malformed version and operation shapes with located diagnostics', () => {
    const empty = operation('get_empty', [{ status: 204, description: 'Done', headers: [], body: { kind: 'empty' } }]);
    expect(() =>
      generateHttpClient(
        contract([
          {
            ...empty,
            version: {
              kind: 'media-type',
              key: 'version',
              values: ['1', '1'],
              default: '1',
            },
          },
        ]),
      ),
    ).toThrow(/get_empty\.version\.values.*duplicate/u);
    expect(() => generateHttpClient(contract([{ ...empty, operationId: 'not-valid' }]))).toThrow(
      /non-reserved TypeScript identifier/u,
    );
    expect(() =>
      generateHttpClient(
        contract([
          {
            ...empty,
            version: {
              kind: 'media-type',
              key: 'version',
              values: ['1', '2'],
              default: '1',
            },
            responses: [
              {
                status: 204,
                description: 'Done',
                headers: [],
                body: { kind: 'empty' },
                versions: { '1': { kind: 'empty' } },
              },
            ],
          },
        ]),
      ),
    ).toThrow(/responses\.204\.versions.*declare exactly/u);
  });

  it('keeps the checked-in generated source and map synchronized', () => {
    const output = generated();
    expect(readFileSync(GENERATED, 'utf8')).toBe(output.source);
    expect(readFileSync(GENERATED_MAP, 'utf8')).toBe(output.sourceMap);
  });
});
