import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';

import type { HttpContractIR, HttpOperationIR, SecurityScheme } from '../contract/index.js';
import { toOpenApi, type OpenApiDocument } from './index.js';

const SCHEMES: Readonly<Record<string, SecurityScheme>> = {
  apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
  authorizationCodeFlow: {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://id.example.test/authorize',
        tokenUrl: 'https://id.example.test/token',
        scopes: { 'posts:read': 'read posts' },
      },
    },
  },
  basicAuth: { type: 'http', scheme: 'basic', description: 'operators only' },
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  clientCredentialsFlow: {
    type: 'oauth2',
    flows: { clientCredentials: { tokenUrl: 'https://id.example.test/token', scopes: {} } },
  },
  implicitFlow: {
    type: 'oauth2',
    flows: { implicit: { authorizationUrl: 'https://id.example.test/authorize', scopes: {} } },
  },
  mesh: { type: 'mutualTLS', description: 'client certificate terminated by the mesh' },
  oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://id.example.test/.well-known/openid-configuration' },
  passwordFlow: {
    type: 'oauth2',
    flows: {
      password: {
        tokenUrl: 'https://id.example.test/token',
        refreshUrl: 'https://id.example.test/refresh',
        scopes: {},
      },
    },
  },
};

function operation(
  operationId: string,
  method: HttpOperationIR['method'],
  security: HttpOperationIR['security'],
  deprecated = false,
): HttpOperationIR {
  return {
    operationId,
    controller: 'SecurityController',
    handler: operationId,
    method,
    path: '/security',
    parameters: [],
    responses: [{ status: 204, description: 'No content', headers: [], body: { kind: 'empty' } }],
    security,
    version: { kind: 'none' },
    deprecated,
  };
}

function contract(
  operations: readonly HttpOperationIR[],
  securitySchemes: HttpContractIR['securitySchemes'] = SCHEMES,
): HttpContractIR {
  return { format: 1, types: {}, operations, securitySchemes };
}

async function validateOpenApi(document: OpenApiDocument): Promise<void> {
  const validator = new Validator();
  const json: Record<string, unknown> = JSON.parse(JSON.stringify(document));
  const result = await validator.validate(json);
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  expect(validator.version).toBe('3.1');
}

describe('security projected from HttpContractIR', () => {
  it('copies every OpenAPI 3.1 security scheme from the shared contract', () => {
    const document = toOpenApi(contract([operation('secured', 'GET', [{ bearerAuth: [] }])]));

    expect(document.components?.securitySchemes).toEqual(SCHEMES);
    expect(Object.keys(document.components?.securitySchemes ?? {})).toEqual(Object.keys(SCHEMES).toSorted());
  });

  it('emits explicit public and protected requirements per operation', () => {
    const document = toOpenApi(
      contract([
        operation('publicOperation', 'GET', []),
        operation('protectedOperation', 'POST', [{ mesh: [], bearerAuth: ['posts:read'] }, { apiKey: [] }]),
      ]),
    );

    expect(document.paths['/security']?.get?.security).toEqual([]);
    expect(document.paths['/security']?.post?.security).toEqual([
      { bearerAuth: ['posts:read'], mesh: [] },
      { apiKey: [] },
    ]);
    expect(document).not.toHaveProperty('security');
  });

  it('emits deprecated only when the shared operation marks it true', () => {
    const document = toOpenApi(
      contract([operation('current', 'GET', [], false), operation('legacy', 'DELETE', [], true)]),
    );

    expect(document.paths['/security']?.get).not.toHaveProperty('deprecated');
    expect(document.paths['/security']?.delete?.deprecated).toBe(true);
  });

  it('refuses a requirement naming a scheme absent from the shared contract', () => {
    const generate = () => toOpenApi(contract([operation('ghost', 'GET', [{ ghostAuth: [] }])]));

    expect(generate).toThrow('OpenAPI contract ghost at security.0.ghostAuth: references an undeclared scheme');
  });

  it('omits components only when the contract declares no security schemes', () => {
    const publicContract = contract([operation('publicOperation', 'GET', [])], {});
    const document = toOpenApi(publicContract);

    expect(Object.keys(document)).toEqual(['openapi', 'info', 'paths']);
    expect(document.paths['/security']?.get?.security).toEqual([]);
  });

  it('validates the projected security document against OpenAPI 3.1', async () => {
    await validateOpenApi(
      toOpenApi(
        contract([
          operation('publicOperation', 'GET', []),
          operation('protectedOperation', 'POST', [{ bearerAuth: ['posts:read'] }], true),
        ]),
      ),
    );
  });

  it('is deterministic with schemes and requirement keys supplied out of order', () => {
    const input = contract([
      operation('protectedOperation', 'GET', [{ mesh: [], bearerAuth: ['posts:write', 'posts:read'] }]),
    ]);
    const first = JSON.stringify(toOpenApi(input));

    expect(JSON.stringify(toOpenApi(input))).toBe(first);
    expect(toOpenApi(input).paths['/security']?.get?.security).toEqual([
      { bearerAuth: ['posts:write', 'posts:read'], mesh: [] },
    ]);
  });
});
