import 'server-only';
import { createApiClient } from '@fixture/lib/api.generated';
import { createNextServerClient } from '@zmdb/next/server';
import type { NextFetchPolicy } from '@zmdb/next/server';

export const SERVER_CREDENTIAL = 'zmdb-next-server-credential-697';

function fixtureOrigin(): string {
  const origin = process.env['ZMDB_NEXT_FIXTURE_ORIGIN'];
  if (origin === undefined || origin.length === 0) {
    throw new Error('ZMDB_NEXT_FIXTURE_ORIGIN is required by the packed Next fixture');
  }
  return origin;
}

export function createFixtureScope(fetchPolicy: NextFetchPolicy) {
  return createNextServerClient({
    createClient: createApiClient,
    baseUrl: `${fixtureOrigin()}/api/upstream`,
    fetch: globalThis.fetch,
    clientHeaders: { 'x-server-secret': SERVER_CREDENTIAL },
    forward: {
      headers: ['authorization', 'x-tenant-id'],
      cookies: ['session'],
    },
    fetchPolicy,
  });
}
