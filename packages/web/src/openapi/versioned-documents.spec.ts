import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';

import type { HttpContractIR, HttpOperationIR, HttpTypeIR } from '../contract/index.js';
import { toOpenApi, type OpenApiDocument } from './index.js';

const STRING_LIST: HttpTypeIR = {
  type: { kind: 'array', element: { kind: 'scalar', scalar: 'string' } },
  openApi: { type: 'array', items: { type: 'string' } },
};
const OBJECT: HttpTypeIR = {
  type: {
    kind: 'object',
    properties: [{ name: 'id', type: { kind: 'scalar', scalar: 'string' }, optional: false, readonly: true }],
  },
  openApi: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
};
const BODY: HttpTypeIR = {
  type: {
    kind: 'object',
    properties: [{ name: 'title', type: { kind: 'scalar', scalar: 'string' }, optional: false, readonly: true }],
  },
  openApi: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};

function response(typeId: string): HttpOperationIR['responses'][number] {
  return {
    status: 200,
    description: 'OK',
    headers: [],
    body: { kind: 'json', mediaType: 'application/json', typeId },
  };
}

function operation(
  operationId: string,
  path: string,
  version: HttpOperationIR['version'],
  typeId: string,
): HttpOperationIR {
  return {
    operationId,
    controller: 'VersionedController',
    handler: operationId,
    method: 'GET',
    path,
    parameters: [],
    responses: [response(typeId)],
    security: [],
    version,
    deprecated: false,
  };
}

function contract(
  operations: readonly HttpOperationIR[],
  types: HttpContractIR['types'] = { list: STRING_LIST, object: OBJECT, body: BODY },
): HttpContractIR {
  return { format: 1, types, operations, securitySchemes: {} };
}

async function validateOpenApi(document: OpenApiDocument): Promise<void> {
  const validator = new Validator();
  const json: Record<string, unknown> = JSON.parse(JSON.stringify(document));
  const result = await validator.validate(json);
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  expect(validator.version).toBe('3.1');
}

describe('versioned OpenAPI documents from HttpContractIR', () => {
  it('preserves independently expanded path-version operations and schemas', async () => {
    const document = toOpenApi(
      contract([
        operation('listPostsV2', '/v2/posts', { kind: 'path', value: '2' }, 'object'),
        operation('listPostsV1', '/v1/posts', { kind: 'path', value: '1' }, 'list'),
      ]),
    );

    expect(Object.keys(document.paths)).toEqual(['/v1/posts', '/v2/posts']);
    expect(document.paths['/v1/posts']?.get?.operationId).toBe('listPostsV1');
    expect(document.paths['/v2/posts']?.get?.operationId).toBe('listPostsV2');
    expect(document.paths['/v1/posts']?.get?.responses['200']?.content?.['application/json']?.schema).toBe(
      STRING_LIST.openApi,
    );
    expect(document.paths['/v2/posts']?.get?.responses['200']?.content?.['application/json']?.schema).toBe(
      OBJECT.openApi,
    );
    await validateOpenApi(document);
  });

  it('emits one header-versioned operation with the contract enum and default', async () => {
    const document = toOpenApi(
      contract([
        operation(
          'listPosts',
          '/posts',
          { kind: 'header', name: 'accept-version', values: ['1', '2'], default: '1' },
          'list',
        ),
      ]),
    );

    expect(document.paths['/posts']?.get?.parameters).toEqual([
      {
        name: 'accept-version',
        in: 'header',
        required: false,
        style: 'simple',
        explode: false,
        schema: { type: 'string', enum: ['1', '2'], default: '1' },
      },
    ]);
    await validateOpenApi(document);
  });

  it('emits versioned response media types while keeping request Content-Type unversioned', async () => {
    const versioned: HttpOperationIR = {
      ...operation(
        'createPost',
        '/posts',
        { kind: 'media-type', key: 'version', values: ['1', '2'], default: '1' },
        'list',
      ),
      method: 'POST',
      requestBody: { kind: 'json', mediaType: 'application/json', typeId: 'body', required: true },
      responses: [
        {
          ...response('list'),
          versions: {
            '1': { kind: 'json', mediaType: 'application/json', typeId: 'list' },
            '2': { kind: 'json', mediaType: 'application/json', typeId: 'object' },
          },
        },
      ],
    };
    const operationDocument = toOpenApi(contract([versioned])).paths['/posts']?.post;

    expect(operationDocument?.requestBody?.content).toEqual({
      'application/json': { schema: BODY.openApi },
    });
    expect(operationDocument?.responses['200']?.content).toEqual({
      'application/json; version=1': { schema: STRING_LIST.openApi },
      'application/json; version=2': { schema: OBJECT.openApi },
    });
    await validateOpenApi(toOpenApi(contract([versioned])));
  });

  it('uses the shared response body for every media version when no override is present', () => {
    const versioned = operation(
      'listPosts',
      '/posts',
      { kind: 'media-type', key: 'version', values: ['1', '2'], default: '1' },
      'list',
    );
    expect(toOpenApi(contract([versioned])).paths['/posts']?.get?.responses['200']?.content).toEqual({
      'application/json; version=1': { schema: STRING_LIST.openApi },
      'application/json; version=2': { schema: STRING_LIST.openApi },
    });
  });

  it('documents neutral and unversioned operations without a version parameter', () => {
    const document = toOpenApi(
      contract([
        operation('health', '/health', { kind: 'neutral' }, 'object'),
        operation('ready', '/ready', { kind: 'none' }, 'object'),
      ]),
    );

    expect(document.paths['/health']?.get?.parameters).toBeUndefined();
    expect(document.paths['/ready']?.get?.parameters).toBeUndefined();
  });

  it('refuses a header default absent from the operation values', () => {
    const invalid = operation(
      'listPosts',
      '/posts',
      { kind: 'header', name: 'accept-version', values: ['2'], default: '1' },
      'list',
    );
    expect(() => toOpenApi(contract([invalid]))).toThrow(
      'OpenAPI contract listPosts at version.default: "1" is not one of the declared values',
    );
  });

  it('refuses per-version response bodies outside media-type versioning', () => {
    const invalid: HttpOperationIR = {
      ...operation(
        'listPosts',
        '/posts',
        { kind: 'header', name: 'accept-version', values: ['1', '2'], default: '1' },
        'list',
      ),
      responses: [
        {
          ...response('list'),
          versions: {
            '1': { kind: 'json', mediaType: 'application/json', typeId: 'list' },
            '2': { kind: 'json', mediaType: 'application/json', typeId: 'object' },
          },
        },
      ],
    };
    expect(() => toOpenApi(contract([invalid]))).toThrow(
      'OpenAPI contract listPosts at responses.0.versions: is present on a response that does not use media-type versioning',
    );
  });

  it('refuses an incomplete media-version response map', () => {
    const invalid: HttpOperationIR = {
      ...operation(
        'listPosts',
        '/posts',
        { kind: 'media-type', key: 'version', values: ['1', '2'], default: '1' },
        'list',
      ),
      responses: [
        {
          ...response('list'),
          versions: { '1': { kind: 'json', mediaType: 'application/json', typeId: 'list' } },
        },
      ],
    };
    expect(() => toOpenApi(contract([invalid]))).toThrow(
      'OpenAPI contract listPosts at responses.0.versions: must declare exactly [1, 2]',
    );
  });

  it('refuses two operations that collide on one public method and path', () => {
    const first = operation(
      'listPostsV1',
      '/posts',
      { kind: 'header', name: 'accept-version', values: ['1'], default: '1' },
      'list',
    );
    const second = operation(
      'listPostsV2',
      '/posts',
      { kind: 'header', name: 'accept-version', values: ['2'], default: '2' },
      'list',
    );
    expect(() => toOpenApi(contract([second, first]))).toThrow(
      'OpenAPI contract listPostsV2 at method/path: GET /posts overlaps operation listPostsV1',
    );
  });

  it('is deterministic with versioned operations supplied out of order', () => {
    const input = contract([
      operation('listPostsV2', '/v2/posts', { kind: 'path', value: '2' }, 'object'),
      operation('listPostsV1', '/v1/posts', { kind: 'path', value: '1' }, 'list'),
    ]);
    const first = JSON.stringify(toOpenApi(input));
    expect(JSON.stringify(toOpenApi(input))).toBe(first);
  });
});
