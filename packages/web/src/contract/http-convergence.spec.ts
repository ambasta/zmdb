import { describe, expect, it } from 'vitest';

import { toOpenApi, type OpenApiDocument } from '../openapi/index.js';
import { HTTP_CONVERGENCE_FIXTURE, type FrozenHttpContract } from './__fixtures__/http-convergence.js';
import type { HttpContractIR } from './index.js';

// Tests freeze for #680 against packages/web/src/contract/SPEC.md §14 and
// packages/client/SPEC.md §§10-12. #681 supplies the contract compiler and
// contract-aware router; #683 supplies the pure IR OpenAPI projection. Client
// generation and the client runtime remain absent, so only those calls stay
// behind the documented frozen boundary and remain `it.fails`.

function unimplemented(what: string): never {
  throw new Error(`${what} has no production implementation`);
}

type GenerateClient = (contract: HttpContractIR) => string;

const projectOpenApi = toOpenApi;
const generateClient: GenerateClient = _contract => unimplemented('@zmdb/client generator');

function operationFrom(document: OpenApiDocument): Record<string, unknown> {
  return Object(document.paths['/accounts/{accountId}']?.patch);
}

function withPath(contract: FrozenHttpContract, path: string): HttpContractIR {
  const operation = contract.operations[0];
  return {
    ...contract,
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

  it('projects every operation dimension from the shared contract', () => {
    const operation = operationFrom(
      projectOpenApi(HTTP_CONVERGENCE_FIXTURE.contract, {
        info: { title: 'Account API', version: '1.0.0' },
      }),
    );
    const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    expect(operation.operationId).toBe('patch_accounts_accountId');
    expect(
      parameters.map(parameter => {
        const record = Object(parameter);
        return `${String(record.in)}:${String(record.name)}`;
      }),
    ).toEqual([
      'path:accountId',
      'query:include',
      'query:dry-run',
      'header:x-request-id',
      'cookie:session',
      'header:accept-version',
    ]);
    expect(Object.keys(Object(operation.responses))).toEqual(['200', '202', '204', '404']);
    expect(Object(operation.requestBody)).toHaveProperty('required', true);
    expect(operation.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
    expect(operation.deprecated).toBe(true);
  });

  // OpenAPI now consumes the shared object; client generation remains absent.
  it.fails('OpenAPI and client generation read the same operation object', () => {
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
    const document = projectOpenApi(HTTP_CONVERGENCE_FIXTURE.contract);
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
