import { fileURLToPath } from 'node:url';

import { apiInstanceCount, ReflectSession } from '@zmdb/compiler/reflect';
import { jsonSchemaFromTypeIR } from '@zmdb/schema-core/ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRouter } from '../../pipeline/index.js';
import {
  AccountsController,
  COLLIDING_ROUTE_CONTRACT,
  DYNAMIC_METADATA_CONTRACT,
  HTTP_CONTRACT,
  HTTP_CONVERGENCE_FIXTURE,
  SHARED_PATH_CONTRACT,
} from '../__fixtures__/http-convergence.js';
import { compileHttpContracts, type HttpContractSource } from './index.js';

const PROJECT = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url));
const FIXTURE = new URL('../__fixtures__/http-convergence.ts', import.meta.url);

let session: ReflectSession;

beforeAll(() => {
  session = ReflectSession.open({ project: PROJECT });
});

afterAll(() => {
  session.close();
});

function source(exportName: string, contract: HttpContractSource['contract']): HttpContractSource {
  return { file: FIXTURE, exportName, contract };
}

function compileConvergence() {
  return compileHttpContracts([source('HTTP_CONTRACT', HTTP_CONTRACT)], { session });
}

describe('@zmdb/web deterministic HTTP contract collection', () => {
  it('collects one stable operation per resolved route', () => {
    const first = compileConvergence();
    const second = compileConvergence();

    expect(JSON.stringify(second.ir)).toBe(JSON.stringify(first.ir));
    expect(first.ir.operations).toEqual(HTTP_CONVERGENCE_FIXTURE.contract.operations);
    expect(first.operations).toHaveLength(1);
    expect(first.operations[0]?.operation).toBe(first.ir.operations[0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ir.operations[0])).toBe(true);
  });

  it('refuses duplicate operation ids', () => {
    const duplicate = source('HTTP_CONTRACT', HTTP_CONTRACT);
    expect(() => compileHttpContracts([duplicate, duplicate], { session })).toThrow(
      'HTTP contract patch_accounts_accountId at operationId: appears more than once',
    );
  });

  it('distinguishes methods sharing one path', () => {
    const compiled = compileHttpContracts([source('SHARED_PATH_CONTRACT', SHARED_PATH_CONTRACT)], { session });

    expect(
      compiled.ir.operations.map(operation => ({
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
      })),
    ).toEqual([
      { operationId: 'get_shared_id', method: 'GET', path: '/shared/:id' },
      { operationId: 'post_shared_id', method: 'POST', path: '/shared/:id' },
    ]);
  });

  it('refuses overlapping final route identities', () => {
    expect(() =>
      compileHttpContracts([source('COLLIDING_ROUTE_CONTRACT', COLLIDING_ROUTE_CONTRACT)], { session }),
    ).toThrow(
      'HTTP contract a_collision_second at method/path/version: GET /collision/:id overlaps operation z_collision_first',
    );
  });

  it('refuses dynamic route metadata', () => {
    expect(() =>
      compileHttpContracts([source('DYNAMIC_METADATA_CONTRACT', DYNAMIC_METADATA_CONTRACT)], { session }),
    ).toThrow('HTTP contract get_dynamic_id at path: must be a static literal, array, or object');
  });

  it('carries every response status and media type', () => {
    const operation = compileConvergence().ir.operations[0];

    expect(operation?.responses.map(response => response.status)).toEqual([200, 202, 204, 404]);
    expect(operation?.responses.map(response => response.body)).toEqual([
      {
        kind: 'json',
        mediaType: 'application/json',
        typeId: 'patch_accounts_accountId/response/200/body',
      },
      {
        kind: 'json',
        mediaType: 'application/json',
        typeId: 'patch_accounts_accountId/response/202/body',
      },
      { kind: 'empty' },
      {
        kind: 'json',
        mediaType: 'application/problem+json',
        typeId: 'patch_accounts_accountId/response/404/body',
      },
    ]);
  });

  it('runtime route and contract share the same method and path', async () => {
    const compiled = compileConvergence();
    const operation = compiled.ir.operations[0];
    const binding = compiled.operations[0];
    if (operation === undefined || binding === undefined) {
      throw new Error('the convergence contract did not compile its one operation');
    }
    expect(binding.operation).toBe(operation);

    const router = createRouter({
      versioning: { kind: 'header', name: 'accept-version', default: '1' },
    });
    router.registerContract(compiled, [new AccountsController()], {
      AccountsController: {
        update: {
          deprecated: true,
          security: operation.security,
          guards: [{ canActivate: () => true }],
        },
      },
    });

    const response = await router.handle({
      method: operation?.method ?? '',
      path: '/accounts/account-681',
      headers: { 'accept-version': '1' },
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.kind === 'text' ? response.body.value : '')).toEqual({ updated: true });
    await expect(
      router.handle({
        method: 'GET',
        path: '/accounts/account-681',
        headers: { 'accept-version': '1' },
      }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it('collects schemas through the one TypeIR walker', () => {
    const before = apiInstanceCount();
    const compiled = compileConvergence();

    expect(apiInstanceCount()).toBe(before);
    for (const type of Object.values(compiled.ir.types)) {
      expect(type.openApi).toEqual(jsonSchemaFromTypeIR(type.type));
    }
  });

  it('reports only the transitive project sources used by the contract', () => {
    const dependencies = compileConvergence().dependencies;

    expect(dependencies).toContain(fileURLToPath(FIXTURE));
    expect(dependencies).toContain(fileURLToPath(new URL('../../routing/index.ts', import.meta.url)));
    expect(dependencies).toContain(fileURLToPath(new URL('../../versioning/index.ts', import.meta.url)));
    expect(dependencies).not.toContain(fileURLToPath(new URL('../../static/index.ts', import.meta.url)));
    expect(dependencies).toEqual([...dependencies].toSorted());
  });
});
