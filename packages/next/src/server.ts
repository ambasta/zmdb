import 'server-only';
import { createNextServerClientFromSources } from './server-runtime.js';
import type { NextRequestSources, NextServerClient, NextServerClientRuntimeOptions } from './server-runtime.js';

export type {
  NextCookie,
  NextCookieStore,
  NextFetch,
  NextFetchCache,
  NextFetchInput,
  NextFetchPolicy,
  NextFetchRequestConfig,
  NextFetchRequestInit,
  NextForwardingPolicy,
  NextHeaderStore,
  NextRequestSources,
  NextServerClient,
} from './server-runtime.js';

export interface NextServerClientOptions<Client extends object> extends NextServerClientRuntimeOptions<Client> {
  readonly request?: NextRequestSources;
}

export async function createNextServerClient<Client extends object>(
  options: NextServerClientOptions<Client>,
): Promise<NextServerClient<Client>> {
  const { request: suppliedRequest, ...runtimeOptions } = options;
  if (suppliedRequest !== undefined) {
    return createNextServerClientFromSources(runtimeOptions, suppliedRequest);
  }
  const { cookies, headers } = await import('next/headers');
  const [requestHeaders, requestCookies] = await Promise.all([headers(), cookies()]);
  return createNextServerClientFromSources(runtimeOptions, {
    headers: requestHeaders,
    cookies: requestCookies,
  });
}
