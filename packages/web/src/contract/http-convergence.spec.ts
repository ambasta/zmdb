import { describe, expect, it } from 'vitest';

import { toOpenApi, type OpenApiDocument } from '../openapi/index.js';
import { Controller, Patch } from '../routing/index.js';
import { Version } from '../versioning/index.js';
import {
  HTTP_CONVERGENCE_FIXTURE,
  REQUEST_BODY_SCHEMA,
  SUCCESS_BODY_SCHEMA,
  type FrozenHttpContract,
} from './__fixtures__/http-convergence.js';

// Tests freeze for #680 against packages/web/src/contract/SPEC.md §14 and
// packages/client/SPEC.md §§10-12. #681 supplies the contract compiler and
// contract-aware router; the pure IR OpenAPI projection, client generator and
// client runtime remain absent. Those missing calls go through one documented
// frozen boundary and remain `it.fails`; the green controls exercise the legacy
// OpenAPI emitter that #683 will replace.

function unimplemented(what: string): never {
  throw new Error(`${what} has no production implementation`);
}

interface ContractInput {
  readonly format: 1;
  readonly operations: readonly {
    readonly operationId: string;
    readonly path: string;
  }[];
}

type ProjectOpenApi = (contract: ContractInput) => OpenApiDocument;
type GenerateClient = (contract: ContractInput) => string;

const projectOpenApi: ProjectOpenApi = _contract => unimplemented('HttpContractIR to OpenAPI projection');
const generateClient: GenerateClient = _contract => unimplemented('@zmdb/client generator');

@Version('1', '2')
@Controller('/accounts')
class AccountsController {
  @Patch('/:accountId')
  update() {}
}

function legacyOpenApi(): OpenApiDocument {
  const schemas = { body: REQUEST_BODY_SCHEMA, response: SUCCESS_BODY_SCHEMA };
  return toOpenApi([AccountsController], {
    info: { title: 'Account API', version: '1.0.0' },
    versioning: { kind: 'header', name: 'accept-version', default: '1' },
    versionSchemas: {
      '/accounts/:accountId': {
        '1': schemas,
        '2': schemas,
      },
    },
    routes: {
      AccountsController: {
        update: {
          security: HTTP_CONVERGENCE_FIXTURE.contract.operations[0].security,
          deprecated: true,
        },
      },
    },
    securitySchemes: HTTP_CONVERGENCE_FIXTURE.contract.securitySchemes,
    strictSecurity: false,
  });
}

function operationFrom(document: OpenApiDocument): Record<string, unknown> {
  return Object(document.paths['/accounts/{accountId}']?.patch);
}

function withPath(contract: FrozenHttpContract, path: string): ContractInput {
  const operation = contract.operations[0];
  return {
    format: contract.format,
    operations: [{ ...operation, path }],
  };
}

describe('the shared HTTP contract convergence fixture', () => {
  it('covers every contract dimension with one realistic operation', () => {
    const operation = HTTP_CONVERGENCE_FIXTURE.contract.operations[0];
    expect(operation.method).toBe('PATCH');
    expect(operation.parameters.map(parameter => parameter.in)).toEqual(['path', 'query', 'query', 'header', 'cookie']);
    expect(operation.requestBody).toEqual({
      kind: 'json',
      mediaType: 'application/json',
      typeId: 'patch_accounts_accountId/request/body',
      required: true,
    });
    expect(operation.responses.map(response => response.status)).toEqual([200, 202, 204, 404]);
    expect(operation.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
    expect(operation.deprecated).toBe(true);
    expect(operation.version).toEqual({
      kind: 'header',
      name: 'accept-version',
      values: ['1', '2'],
      default: '1',
    });
    expect(HTTP_CONVERGENCE_FIXTURE.bodyKinds.map(body => body.kind)).toEqual([
      'json',
      'text',
      'bytes',
      'stream',
      'empty',
    ]);
  });

  it("records today's real path-keyed OpenAPI projection before convergence", () => {
    const operation = operationFrom(legacyOpenApi());
    const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    expect(operation.operationId).toBe('patch_accounts_accountId');
    expect(
      parameters.map(parameter => {
        const record = Object(parameter);
        return `${String(record.in)}:${String(record.name)}`;
      }),
    ).toEqual(['path:accountId', 'header:accept-version']);
    expect(Object.keys(Object(operation.responses))).toEqual(['200']);
    expect(Object(operation.requestBody)).toEqual({
      content: { 'application/json': { schema: REQUEST_BODY_SCHEMA } },
    });
    expect(operation.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
    expect(operation.deprecated).toBe(true);
  });

  // Current measured state: the legacy projection above still consumes controller
  // metadata plus path-keyed schemas; pure IR OpenAPI and client generation are absent.
  it.fails('OpenAPI and client generation read the same operation object', () => {
    expect(operationFrom(legacyOpenApi()).operationId).toBe('patch_accounts_accountId');
    const openApi = projectOpenApi(HTTP_CONVERGENCE_FIXTURE.contract);
    const clientSource = generateClient(HTTP_CONVERGENCE_FIXTURE.contract);
    expect(operationFrom(openApi).operationId).toBe(HTTP_CONVERGENCE_FIXTURE.contract.operations[0].operationId);
    expect(clientSource).toContain('patch_accounts_accountId');
  });

  // Current measured state: changing this serialisable operation changes neither
  // today's decorator-collected document nor any client output, because no client
  // generator exists.
  it.fails('changing a route changes both outputs', () => {
    const before = HTTP_CONVERGENCE_FIXTURE.contract;
    const after = withPath(before, '/accounts/:accountId/profile');
    expect(JSON.stringify(projectOpenApi(after))).not.toBe(JSON.stringify(projectOpenApi(before)));
    expect(generateClient(after)).not.toBe(generateClient(before));
  });

  // The final generator accepts HttpContractIR only. Reflect.apply is deliberate:
  // it exercises the untyped JavaScript boundary without weakening the frozen
  // TypeScript signature merely to make an invalid call compile.
  it.fails('cannot generate a client from an OpenAPI document', () => {
    const document = legacyOpenApi();
    expect(() => Reflect.apply(generateClient, undefined, [document])).toThrow(/HttpContractIR/);
  });

  it.fails('does not include credentials in generated source', () => {
    const credential = 'credential-must-never-enter-generated-source';
    const tainted = { ...HTTP_CONVERGENCE_FIXTURE.contract, credential };
    expect(generateClient(tainted)).not.toContain(credential);
  });

  it.fails('emits byte-identical output twice', () => {
    const first = generateClient(HTTP_CONVERGENCE_FIXTURE.contract);
    expect(generateClient(HTTP_CONVERGENCE_FIXTURE.contract)).toBe(first);
  });
});
