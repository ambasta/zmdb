import { defineHttpContract, httpOperation } from '@zmdb/web/contract';
import { Controller, Get, Public } from '@zmdb/web/routing';

import type { AcceptedAccount, Account, Health } from './models.js';

const previousLoads: unknown = Reflect.get(globalThis, '__zmdbHttpContractFixtureLoads');
Reflect.set(globalThis, '__zmdbHttpContractFixtureLoads', typeof previousLoads === 'number' ? previousLoads + 1 : 1);

interface GetAccountOperation {
  readonly path: { readonly accountId: string };
  readonly responses: {
    readonly 200: { readonly body: Account };
    readonly 202: { readonly body: AcceptedAccount };
  };
}

interface HealthOperation {
  readonly responses: {
    readonly 200: { readonly body: Health };
  };
}

@Controller('/accounts')
export class AccountsController {
  @Get('/:accountId')
  getAccount() {
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
    get_accounts_accountId: httpOperation<GetAccountOperation>({
      controller: AccountsController,
      handler: 'getAccount',
      method: 'GET',
      path: '/accounts/:accountId',
      parameters: [{ in: 'path', property: 'accountId', name: 'accountId' }],
      responses: {
        200: {
          description: 'Found',
          body: { kind: 'json', mediaType: 'application/json' },
        },
        202: {
          description: 'Accepted',
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
    get_accounts_health: httpOperation<HealthOperation>({
      controller: AccountsController,
      handler: 'health',
      method: 'GET',
      path: '/accounts/health',
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
