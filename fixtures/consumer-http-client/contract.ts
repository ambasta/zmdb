import { Controller, type Ctx, Get, json } from '@zmdb/web';
import { defineHttpContract, httpOperation } from '@zmdb/web/contract';

import './metadata.js';
import type { AcceptedAccount, Account } from './models.js';

export const FIXTURE_TOKEN = 'fixture-token';

interface GetAccountOperation {
  readonly path: { readonly accountId: string };
  readonly responses: {
    readonly 200: { readonly body: Account };
    readonly 202: { readonly body: AcceptedAccount };
  };
}

@Controller('/accounts')
export class FixtureController {
  @Get('/:accountId')
  getAccount(ctx: Ctx<{ readonly accountId: string }>) {
    const authenticated = ctx.headers.authorization === `Bearer ${FIXTURE_TOKEN}`;
    if (ctx.params.accountId === 'accepted') {
      return json({ jobId: 'job-accepted', authenticated }, { status: 202 });
    }
    if (ctx.params.accountId === 'invalid') {
      return json({ id: 17, displayName: 'Invalid', authenticated });
    }
    return json({
      id: ctx.params.accountId,
      displayName: `Account ${ctx.params.accountId}`,
      authenticated,
    });
  }
}

export const HTTP_CONTRACT = defineHttpContract({
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
  },
  operations: {
    get_fixture_account: httpOperation<GetAccountOperation>({
      controller: FixtureController,
      handler: 'getAccount',
      method: 'GET',
      path: '/accounts/:accountId',
      parameters: [{ in: 'path', property: 'accountId', name: 'accountId' }],
      responses: {
        200: {
          description: 'Account',
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
