import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HTTP_CONVERGENCE_FIXTURE } from '../contract/__fixtures__/http-convergence.js';
import type { HttpContractIR, HttpOperationIR, HttpTypeIR } from '../contract/index.js';
import { serveOpenApi, toOpenApi } from './index.js';

const CONTRACT: HttpContractIR = HTTP_CONVERGENCE_FIXTURE.contract;
const STRING_TYPE: HttpTypeIR = {
  type: { kind: 'scalar', scalar: 'string' },
  openApi: { type: 'string' },
};

function publicOperation(
  operationId: string,
  method: HttpOperationIR['method'],
  path: string,
  responses: HttpOperationIR['responses'],
): HttpOperationIR {
  return {
    operationId,
    controller: 'FixtureController',
    handler: operationId,
    method,
    path,
    parameters: [],
    responses,
    security: [],
    version: { kind: 'none' },
    deprecated: false,
  };
}

function contract(operations: readonly HttpOperationIR[], types: HttpContractIR['types'] = {}): HttpContractIR {
  return { format: 1, types, operations, securitySchemes: {} };
}

describe('@zmdb/web openapi: HttpContractIR projection', () => {
  it('emits a 3.1 doc from HttpContractIR with converted path params', () => {
    const document = toOpenApi(CONTRACT, { info: { title: 'Accounts', version: '1.0.0' } });
    const operation = document.paths['/accounts/{accountId}']?.patch;

    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toEqual({ title: 'Accounts', version: '1.0.0' });
    expect(operation?.operationId).toBe('patch_accounts_accountId');
    expect(operation?.parameters).toEqual([
      {
        name: 'accountId',
        in: 'path',
        required: true,
        style: 'simple',
        explode: false,
        allowReserved: false,
        schema: { type: 'string' },
      },
      {
        name: 'include',
        in: 'query',
        required: false,
        style: 'form',
        explode: true,
        allowReserved: false,
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'dry-run',
        in: 'query',
        required: false,
        style: 'form',
        explode: true,
        allowReserved: false,
        schema: { type: 'boolean' },
      },
      {
        name: 'x-request-id',
        in: 'header',
        required: false,
        style: 'simple',
        explode: false,
        schema: { type: 'string' },
      },
      {
        name: 'session',
        in: 'cookie',
        required: true,
        style: 'form',
        explode: true,
        schema: { type: 'string' },
      },
      {
        name: 'accept-version',
        in: 'header',
        required: false,
        style: 'simple',
        explode: false,
        schema: { type: 'string', enum: ['1', '2'], default: '1' },
      },
    ]);
  });

  it('serves the prebuilt document by identity', () => {
    const document = toOpenApi(CONTRACT);
    const handler = serveOpenApi(document);

    expect(handler()).toBe(document);
    expect(handler()).toBe(handler());
  });

  it('two methods on one path receive distinct schemas', () => {
    const types = {
      'get-users/response/200/body': {
        ...STRING_TYPE,
        openApi: { type: 'array', items: { type: 'string' } },
      },
      'create-users/request/body': {
        ...STRING_TYPE,
        openApi: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
      },
      'create-users/response/201/body': {
        ...STRING_TYPE,
        openApi: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    } satisfies HttpContractIR['types'];
    const get = publicOperation('readUsers', 'GET', '/users', [
      {
        status: 200,
        description: 'Users',
        headers: [],
        body: { kind: 'json', mediaType: 'application/json', typeId: 'get-users/response/200/body' },
      },
    ]);
    const post: HttpOperationIR = {
      ...publicOperation('createUsers', 'POST', '/users', [
        {
          status: 201,
          description: 'Created',
          headers: [],
          body: { kind: 'json', mediaType: 'application/json', typeId: 'create-users/response/201/body' },
        },
      ]),
      requestBody: {
        kind: 'json',
        mediaType: 'application/json',
        typeId: 'create-users/request/body',
        required: true,
      },
    };

    const item = toOpenApi(contract([post, get], types)).paths['/users'];
    expect(item?.get?.operationId).toBe('readUsers');
    expect(item?.get?.requestBody).toBeUndefined();
    expect(item?.get?.responses['200']?.content?.['application/json']?.schema).toBe(
      types['get-users/response/200/body'].openApi,
    );
    expect(item?.post?.operationId).toBe('createUsers');
    expect(item?.post?.requestBody?.content['application/json']?.schema).toBe(
      types['create-users/request/body'].openApi,
    );
    expect(item?.post?.responses['201']?.content?.['application/json']?.schema).toBe(
      types['create-users/response/201/body'].openApi,
    );
  });

  it('emits every documented status, header and body kind', () => {
    const operation: HttpOperationIR = {
      ...publicOperation('bodyKinds', 'POST', '/body-kinds', [
        {
          status: 200,
          description: 'JSON',
          headers: [
            {
              property: 'requestId',
              name: 'x-request-id',
              description: 'Trace identifier',
              required: true,
              typeId: 'header',
            },
          ],
          body: { kind: 'json', mediaType: 'application/json', typeId: 'json' },
        },
        { status: 201, description: 'Text', headers: [], body: { kind: 'text', mediaType: 'text/plain' } },
        {
          status: 202,
          description: 'Bytes',
          headers: [],
          body: { kind: 'bytes', mediaType: 'application/octet-stream' },
        },
        {
          status: 203,
          description: 'Stream',
          headers: [],
          body: { kind: 'stream', mediaType: 'application/x-ndjson' },
        },
        { status: 204, description: 'Empty', headers: [], body: { kind: 'empty' } },
      ]),
      requestBody: { kind: 'text', mediaType: 'text/plain', required: false },
    };
    const document = toOpenApi(contract([operation], { header: STRING_TYPE, json: STRING_TYPE }));
    const projected = document.paths['/body-kinds']?.post;

    expect(projected?.requestBody).toEqual({
      required: false,
      content: { 'text/plain': { schema: { type: 'string' } } },
    });
    expect(Object.keys(projected?.responses ?? {})).toEqual(['200', '201', '202', '203', '204']);
    expect(projected?.responses['200']?.headers?.['x-request-id']).toEqual({
      required: true,
      schema: { type: 'string' },
      description: 'Trace identifier',
    });
    expect(projected?.responses['201']?.content).toEqual({ 'text/plain': { schema: { type: 'string' } } });
    expect(projected?.responses['202']?.content).toEqual({
      'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
    });
    expect(projected?.responses['203']?.content).toEqual({
      'application/x-ndjson': { schema: { type: 'string', format: 'binary' } },
    });
    expect(projected?.responses['204']?.content).toBeUndefined();
  });

  it('emits byte-identical output twice without reading TypeIR', () => {
    const type = Object.defineProperty({ openApi: { type: 'string' } }, 'type', {
      get() {
        throw new Error('TypeIR traversal reached the renderer');
      },
    });
    const guardedContract = contract(
      [
        publicOperation('noTypeWalk', 'GET', '/pure', [
          {
            status: 200,
            description: 'OK',
            headers: [],
            body: { kind: 'json', mediaType: 'application/json', typeId: 'hostile' },
          },
        ]),
      ],
      { hostile: type as unknown as HttpTypeIR },
    );

    const first = JSON.stringify(toOpenApi(guardedContract));
    expect(JSON.stringify(toOpenApi(guardedContract))).toBe(first);
  });

  it('refuses malformed IR instead of emitting a partial document', () => {
    const missingType = contract([
      publicOperation('missingType', 'GET', '/missing', [
        {
          status: 200,
          description: 'OK',
          headers: [],
          body: { kind: 'json', mediaType: 'application/json', typeId: 'absent' },
        },
      ]),
    ]);
    expect(() => toOpenApi(missingType)).toThrow(
      'OpenAPI contract missingType at responses.0.body.typeId: references missing typeId "absent"',
    );

    const first = publicOperation('first', 'GET', '/collision', [
      { status: 204, description: 'Empty', headers: [], body: { kind: 'empty' } },
    ]);
    const second = { ...first, operationId: 'second', handler: 'second' };
    expect(() => toOpenApi(contract([second, first]))).toThrow(
      'OpenAPI contract second at method/path: GET /collision overlaps operation first',
    );

    const invalidFormat = { ...CONTRACT, format: 2 };
    expect(() => Reflect.apply(toOpenApi, undefined, [invalidFormat])).toThrow(
      'OpenAPI contract at format: unsupported HttpContractIR format 2',
    );
  });

  it('OpenAPI reads no controller metadata or compiler backend directly', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);

    expect(imports).toEqual(['../contract/index.js', '../contract/index.js']);
    for (const forbidden of [
      'getRoutes',
      'versionsOf',
      'isPublic',
      'resolveGuards',
      'Reflector',
      'jsonSchemaFromTypeIR',
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});
