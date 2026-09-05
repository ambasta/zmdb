// AOT-generated JSON Schemas entering OpenAPI through HttpContractIR.
//
// The plugin still owns TypeScript-to-schema projection. This suite proves the
// resulting documents can be attached to method-specific type IDs and that the
// OpenAPI backend copies those documents without another schema walk.

import { readFileSync } from 'node:fs';

import { zmdbAot } from '@zmdb/aot-validator/plugin';
import { beforeAll, describe, expect, it } from 'vitest';

import type { HttpContractIR, HttpTypeIR } from '../contract/index.js';
import { toOpenApi, type JsonSchema } from './index.js';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const FILE = `${FIXTURES}route-schemas.ts`;

interface GeneratedDocuments {
  readonly body: JsonSchema;
  readonly response: JsonSchema;
}

let documents: GeneratedDocuments | undefined;
let emitted = '';

beforeAll(() => {
  const plugin = zmdbAot({ project: `${FIXTURES}tsconfig.json`, cwd: FIXTURES });
  const source = readFileSync(FILE, 'utf8');
  const result = plugin.transform(source, FILE);
  plugin.buildEnd?.();
  if (!result) throw new Error('the plugin declined to transform the fixture');
  emitted = result.code;

  const body = emitted
    .replace(/^import\b[^;]*;\s*$/gm, '')
    .replace(/^interface\b[\s\S]*?^}\s*$/gm, '')
    .replace(/^declare\b.*$/gm, '');
  const run = new Function('documents', body) as (fn: (value: GeneratedDocuments) => void) => void;
  run(value => {
    documents = value;
  });
});

function generated(): GeneratedDocuments {
  if (documents === undefined) throw new Error('the generated schema fixture did not run');
  return documents;
}

function type(openApi: JsonSchema): HttpTypeIR {
  return { type: { kind: 'scalar', scalar: 'string' }, openApi };
}

function generatedContract(): HttpContractIR {
  const schemas = generated();
  return {
    format: 1,
    types: {
      'createUser/request/body': type(schemas.body),
      'createUser/response/201/body': type(schemas.response),
    },
    operations: [
      {
        operationId: 'createUser',
        controller: 'UsersController',
        handler: 'create',
        method: 'POST',
        path: '/users',
        parameters: [],
        requestBody: {
          kind: 'json',
          mediaType: 'application/json',
          typeId: 'createUser/request/body',
          required: true,
        },
        responses: [
          {
            status: 201,
            description: 'Created',
            headers: [],
            body: {
              kind: 'json',
              mediaType: 'application/json',
              typeId: 'createUser/response/201/body',
            },
          },
        ],
        security: [],
        version: { kind: 'none' },
        deprecated: false,
      },
    ],
    securitySchemes: {},
  };
}

function code(): string[] {
  return emitted
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'));
}

describe('toOpenApi fed from generated HttpContractIR schemas', () => {
  it('produces both schema documents through the real AOT transform', () => {
    expect(generated().body).toBeDefined();
    expect(generated().response).toBeDefined();
    expect(code().filter(line => line.includes('toJsonSchema'))).toEqual([
      "import { toJsonSchema, type JsonSchemaObject } from '@zmdb/schema-core/openapi';",
    ]);
  });

  it('describes the create body the type describes', () => {
    expect(generated().body).toEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        email: { type: 'string', maxLength: 255 },
      },
      required: ['email'],
    });
  });

  it('never publishes a sensitive column, in the body or the response', () => {
    for (const document of [generated().body, generated().response]) {
      expect(Object.keys(Object(document.properties))).not.toContain('passwordHash');
    }
    expect(emitted).not.toContain('passwordHash');
  });

  it('embeds the documents in the OpenAPI document', () => {
    const schemas = generated();
    const operation = toOpenApi(generatedContract(), {
      info: { title: 'Users', version: '1.0.0' },
    }).paths['/users']?.post;

    expect(operation?.requestBody?.content['application/json']?.schema).toBe(schemas.body);
    expect(operation?.responses['201']?.content?.['application/json']?.schema).toBe(schemas.response);
  });

  it('hands out the frozen compiler projection rather than rebuilding it', () => {
    expect(Object.isFrozen(generated().body)).toBe(true);
  });
});
