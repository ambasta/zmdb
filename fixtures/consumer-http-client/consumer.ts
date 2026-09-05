import { ResponseValidationError } from '@zmdb/client';

import { createApiClient } from './generated/http-client.generated.js';

declare const FIXTURE_BASE_URL: string;
declare const FIXTURE_KIND: 'browser' | 'node';

let authenticationCalls = 0;
const client = createApiClient({
  baseUrl: FIXTURE_BASE_URL,
  authentication: context => {
    authenticationCalls += 1;
    if (context.operationId !== 'get_fixture_account') {
      throw new Error(`unexpected operation ${context.operationId}`);
    }
    return {
      requirement: 0,
      headers: { authorization: 'Bearer fixture-token' },
    };
  },
});

const success = await client.get_fixture_account({ path: { accountId: 'success' } });
if (success.status !== 200) throw new Error(`expected status 200, received ${String(success.status)}`);
if (success.body.id !== 'success' || success.body.authenticated !== true) {
  throw new Error(`${FIXTURE_KIND} consumer did not receive the authenticated success response`);
}

const accepted = await client.get_fixture_account({ path: { accountId: 'accepted' } });
if (accepted.status !== 202) throw new Error(`expected status 202, received ${String(accepted.status)}`);
if (accepted.body.jobId !== 'job-accepted' || accepted.body.authenticated !== true) {
  throw new Error(`${FIXTURE_KIND} consumer did not receive the alternate success response`);
}

let rejectedInvalidBody = false;
try {
  await client.get_fixture_account({ path: { accountId: 'invalid' } });
} catch (error) {
  rejectedInvalidBody = error instanceof ResponseValidationError && error.status === 200 && error.issues.length > 0;
}
if (!rejectedInvalidBody) {
  throw new Error(`${FIXTURE_KIND} consumer accepted an invalid successful response body`);
}
if (authenticationCalls !== 3) {
  throw new Error(`${FIXTURE_KIND} consumer injected authentication ${String(authenticationCalls)} times`);
}

globalThis.console.log(`${FIXTURE_KIND}-packed-client-ok`);
