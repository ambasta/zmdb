// Round-trip the IR-backed OpenAPI document through @zmdb/ai's tool generator.
//
// This stays in @zmdb/web because @zmdb/ai is below web in the dependency graph
// and cannot import the OpenAPI renderer. The AOT plugin supplies request and
// response schemas; HttpContractIR supplies operation identity and method-specific use.
import { readFileSync } from 'node:fs';

import type { ToolSpec } from '@zmdb/ai';
import { generateOpenApiToolsModule, toolsFromOpenApi } from '@zmdb/ai/http';
import { zmdbAot } from '@zmdb/aot-validator/plugin';
import { beforeAll, describe, expect, it } from 'vitest';

import type { HttpContractIR, HttpOperationIR, HttpParameterIR, HttpTypeIR } from '../contract/index.js';
import { toOpenApi, type JsonSchema } from './index.js';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const FILE = `${FIXTURES}route-schemas.ts`;
const GENERATED_FILE = `${FIXTURES}openapi-tools.fixture.ts`;

interface GeneratedDocuments {
  readonly body: JsonSchema;
  readonly response: JsonSchema;
}

interface RouteFixture {
  readonly operationId: string;
  readonly method: HttpOperationIR['method'];
  readonly path: string;
  readonly body: boolean;
  readonly response: boolean;
}

const ROUTES: readonly RouteFixture[] = [
  { operationId: 'list_users', method: 'GET', path: '/users', body: false, response: true },
  { operationId: 'post_users', method: 'POST', path: '/users', body: true, response: true },
  { operationId: 'get_users_health', method: 'GET', path: '/users/health', body: false, response: false },
  { operationId: 'get_users_id', method: 'GET', path: '/users/:id', body: false, response: false },
  { operationId: 'post_users_id_roles', method: 'POST', path: '/users/:id/roles', body: false, response: false },
  {
    operationId: 'put_users_id_roles_roleId',
    method: 'PUT',
    path: '/users/:id/roles/:roleId',
    body: false,
    response: false,
  },
  { operationId: 'delete_users_id', method: 'DELETE', path: '/users/:id', body: false, response: false },
];

let documents: GeneratedDocuments | undefined;
let generatedSource = '';
let generatedEmitted = '';

beforeAll(() => {
  const plugin = zmdbAot({ project: `${FIXTURES}tsconfig.json`, cwd: FIXTURES });
  const result = plugin.transform(readFileSync(FILE, 'utf8'), FILE);
  generatedSource = readFileSync(GENERATED_FILE, 'utf8');
  const transformedGenerated = plugin.transform(generatedSource, GENERATED_FILE);
  plugin.buildEnd?.();
  if (!result) throw new Error('the plugin declined to transform the fixture');
  if (!transformedGenerated) throw new Error('the plugin declined to compile generated OpenAPI validators');
  generatedEmitted = transformedGenerated.code;

  const body = result.code
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

function pathNames(path: string): readonly string[] {
  return [...path.matchAll(/:([^/]+)/g)].map(match => match[1] ?? '');
}

function parameter(operationId: string, name: string): HttpParameterIR {
  return {
    property: name,
    name,
    in: 'path',
    required: true,
    typeId: `${operationId}/parameter/path/${name}`,
  };
}

function contract(): HttpContractIR {
  const schemas = generated();
  const types: Record<string, HttpTypeIR> = {};
  const operations = ROUTES.map(route => {
    const parameters = pathNames(route.path).map(name => {
      const value = parameter(route.operationId, name);
      types[value.typeId] = {
        type: { kind: 'scalar', scalar: 'string' },
        openApi: { type: 'string' },
      };
      return value;
    });

    const responseTypeId = `${route.operationId}/response/200/body`;
    if (route.response) {
      types[responseTypeId] = {
        type: { kind: 'scalar', scalar: 'string' },
        openApi: schemas.response,
      };
    }
    const bodyTypeId = `${route.operationId}/request/body`;
    if (route.body) {
      types[bodyTypeId] = {
        type: { kind: 'scalar', scalar: 'string' },
        openApi: schemas.body,
      };
    }

    return {
      operationId: route.operationId,
      controller: 'UsersController',
      handler: route.operationId,
      method: route.method,
      path: route.path,
      parameters,
      ...(route.body
        ? {
            requestBody: {
              kind: 'json' as const,
              mediaType: 'application/json',
              typeId: bodyTypeId,
              required: true,
            },
          }
        : {}),
      responses: route.response
        ? [
            {
              status: 200,
              description: 'OK',
              headers: [],
              body: {
                kind: 'json' as const,
                mediaType: 'application/json',
                typeId: responseTypeId,
              },
            },
          ]
        : [{ status: 204, description: 'No content', headers: [], body: { kind: 'empty' as const } }],
      security: [],
      version: { kind: 'none' as const },
      deprecated: false,
    } satisfies HttpOperationIR;
  });
  return { format: 1, types, operations, securitySchemes: {} };
}

function document(): ReturnType<typeof toOpenApi> {
  return toOpenApi(contract(), { info: { title: 'Users', version: '1.0.0' } });
}

function operationsOf(
  value: ReturnType<typeof toOpenApi>,
): readonly { readonly path: string; readonly method: string; readonly operationId: string }[] {
  return Object.entries(value.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({ path, method, operationId: operation.operationId })),
  );
}

function byName(specs: readonly ToolSpec[], name: string): ToolSpec | undefined {
  return specs.find(spec => spec.name === name);
}

function propertyNamesOf(spec: ToolSpec | undefined): readonly string[] {
  return spec === undefined ? [] : Object.keys(spec.parameters.properties).toSorted();
}

describe('what the IR-backed OpenAPI round trip preserves', () => {
  it('keeps request schemas method-specific on a shared path', () => {
    const item = document().paths['/users'];

    expect(item?.get?.requestBody).toBeUndefined();
    expect(item?.post?.requestBody?.content['application/json']?.schema).toBe(generated().body);
  });

  it('emits a Date column as an ISO string, and a defaulted column as not required', () => {
    expect(generated().body).toStrictEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        email: { type: 'string', maxLength: 255 },
      },
      required: ['email'],
    });
  });

  it('keeps a sensitive column out of the generated document entirely', () => {
    expect(JSON.stringify(document())).not.toContain('passwordHash');
  });

  it('copies every explicit operationId and preserves it across regenerations', () => {
    const actual = operationsOf(document())
      .map(operation => operation.operationId)
      .toSorted();
    const expected = ROUTES.map(route => route.operationId).toSorted();

    expect(actual).toEqual(expected);
    expect(actual).toContain('post_users_id_roles');
    expect(new Set(actual).size).toBe(actual.length);
    expect(operationsOf(document())).toEqual(operationsOf(document()));
  });

  it('keeps the checked-in module in sync and compiles its validators through the existing emitter', () => {
    expect(generateOpenApiToolsModule(document())).toBe(generatedSource);
    expect(generatedSource).toContain('export type GetUsersHealthArguments = Readonly<Record<never, never>>;');
    expect(generatedEmitted).not.toContain('assert<');
    expect(generatedEmitted).toContain('typeof _v.email === "string"');
    expect(generatedEmitted).toContain('_v.email.length <= 255');
  });

  it('gives every shared-contract operation exactly one tool', () => {
    const specs = toolsFromOpenApi(document());

    expect(specs).toHaveLength(ROUTES.length);
    expect(specs.map(spec => spec.name).toSorted()).toEqual(ROUTES.map(route => route.operationId).toSorted());
    expect(new Set(specs.map(spec => spec.name)).size).toBe(specs.length);
  });

  it('makes every path parameter a required string property on its tool', () => {
    const specs = toolsFromOpenApi(document());
    let asserted = 0;

    for (const route of ROUTES) {
      const spec = byName(specs, route.operationId);
      for (const name of pathNames(route.path)) {
        expect(spec?.parameters.properties[name], `${route.path}: ${name}`).toEqual({ type: 'string' });
        expect(spec?.parameters.required, `${route.path}: ${name}`).toContain(name);
        asserted += 1;
      }
    }
    expect(asserted).toBe(5);
    expect(JSON.stringify(specs)).not.toContain('{id}');
  });

  it('puts body properties only on the operation whose IR declares a body', () => {
    const specs = toolsFromOpenApi(document());

    expect(propertyNamesOf(byName(specs, 'list_users'))).toEqual([]);
    expect(propertyNamesOf(byName(specs, 'post_users'))).toEqual(['createdAt', 'email']);
    expect(byName(specs, 'post_users')?.parameters.required).toEqual(['email']);
    expect(propertyNamesOf(byName(specs, 'get_users_id'))).toEqual(['id']);
    expect(propertyNamesOf(byName(specs, 'put_users_id_roles_roleId'))).toEqual(['id', 'roleId']);
    expect(propertyNamesOf(byName(specs, 'post_users'))).not.toContain('id');
  });

  it('round-trips generated schemas without recovering or traversing TypeIR', () => {
    const specs = toolsFromOpenApi(document());
    const create = byName(specs, 'post_users');

    expect(create?.parameters.properties['createdAt']).toEqual({
      type: 'string',
      format: 'date-time',
    });
    expect(create?.parameters.properties['email']).toEqual({ type: 'string', maxLength: 255 });
    expect(JSON.stringify(specs)).not.toContain('passwordHash');
    expect(JSON.stringify(specs)).not.toContain('timestamp');
  });
});
