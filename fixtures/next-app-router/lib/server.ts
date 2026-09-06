import 'server-only';
import { createApiClient } from '@fixture/lib/api.generated';
import type { Widget } from '@fixture/lib/api.generated';
import { createNextServerClient } from '@zmdb/next/server';
import type { NextFetchPolicy } from '@zmdb/next/server';

export const SERVER_CREDENTIAL = 'zmdb-next-server-credential-697';

export interface FixtureObservation {
  readonly id: string;
  readonly requestId: string;
  readonly authorization: string;
  readonly tenant: string;
  readonly session: string;
  readonly ignoredHeader: boolean;
  readonly ignoredCookie: boolean;
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

export function readFixtureObservation(widget: Widget): FixtureObservation {
  const value: unknown = JSON.parse(widget.name);
  const requestId = field(value, 'requestId');
  const authorization = field(value, 'authorization');
  const tenant = field(value, 'tenant');
  const session = field(value, 'session');
  const ignoredHeader = field(value, 'ignoredHeader');
  const ignoredCookie = field(value, 'ignoredCookie');
  if (
    typeof requestId !== 'string' ||
    typeof authorization !== 'string' ||
    typeof tenant !== 'string' ||
    typeof session !== 'string' ||
    typeof ignoredHeader !== 'boolean' ||
    typeof ignoredCookie !== 'boolean'
  ) {
    throw new Error(`packed Next fixture received an invalid observation for ${widget.id}`);
  }
  return {
    id: widget.id,
    requestId,
    authorization,
    tenant,
    session,
    ignoredHeader,
    ignoredCookie,
  };
}

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
