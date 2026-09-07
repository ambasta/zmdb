import { defineHttpContract, httpOperation } from '@zmdb/web/contract';
import { Controller, Get, Public } from '@zmdb/web/routing';

import type { UserView, Health } from './models.js';

const previousLoads: unknown = Reflect.get(globalThis, '__zmdbHttpContractFixtureLoads');
Reflect.set(globalThis, '__zmdbHttpContractFixtureLoads', typeof previousLoads === 'number' ? previousLoads + 1 : 1);

interface GetUserOperation {
  readonly path: { readonly userId: string };
  readonly responses: {
    readonly 200: { readonly body: UserView };
  };
}

interface HealthOperation {
  readonly responses: {
    readonly 200: { readonly body: Health };
  };
}

@Controller('/users')
export class UsersController {
  @Get('/:userId')
  getUser() {
    return { id: 'account-1', displayName: 'Account 1' };
  }

  @Public()
  @Get('/health')
  health() {
    return { ok: true };
  }
}

export const HTTP_CONTRACT = defineHttpContract({
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
  },
  operations: {
    get_users_userId: httpOperation<GetUserOperation>({
      controller: UsersController,
      handler: 'getUser',
      method: 'GET',
      path: '/users/:userId',
      parameters: [{ in: 'path', property: 'userId', name: 'userId' }],
      responses: {
        200: {
          description: 'Found',
          body: { kind: 'json', mediaType: 'application/json' },
        },
      },
      security: [{ bearerAuth: [] }],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});

export const HEALTH_CONTRACT = defineHttpContract({
  securitySchemes: {},
  operations: {
    get_health: httpOperation<HealthOperation>({
      controller: UsersController,
      handler: 'health',
      method: 'GET',
      path: '/users/health',
      parameters: [],
      responses: {
        200: {
          description: 'Healthy',
          body: { kind: 'json', mediaType: 'application/json' },
        },
      },
      security: [],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});
