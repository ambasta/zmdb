import { ClientRequestError, createFetchTransport } from '@zmdb/client';
import type { AuthenticationProvider, ClientHeaders, ClientOptions } from '@zmdb/client';
import { mergeClientHeaders, normalizeClientHeaders } from '@zmdb/client/headers';
import type { FetchLike } from '@zmdb/client/transport';

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

export interface NextHeaderStore {
  get(name: string): string | null;
}

export interface NextCookie {
  readonly value: string;
}

export interface NextCookieStore {
  get(name: string): NextCookie | undefined;
}

export interface NextRequestSources {
  readonly headers: NextHeaderStore;
  readonly cookies: NextCookieStore;
}

export interface NextFetchRequestConfig {
  readonly revalidate?: number | false;
  readonly tags?: string[];
}

export type NextFetchInput = Parameters<FetchLike>[0];

export type NextFetchRequestInit = NonNullable<Parameters<FetchLike>[1]> & {
  readonly next?: NextFetchRequestConfig | undefined;
};

export type NextFetch = (input: NextFetchInput, init?: NextFetchRequestInit) => ReturnType<FetchLike>;

export type NextFetchCache = NonNullable<NextFetchRequestInit['cache']>;

export interface NextFetchPolicy {
  readonly cache?: NextFetchCache;
  readonly next?: NextFetchRequestConfig;
}

export interface NextForwardingPolicy {
  readonly headers?: readonly string[];
  readonly cookies?: readonly string[];
}

export interface NextServerClientRuntimeOptions<Client extends object> {
  readonly createClient: (options: ClientOptions) => Client;
  readonly baseUrl: string | URL;
  readonly fetch: NextFetch;
  readonly forward?: NextForwardingPolicy;
  readonly fetchPolicy?: NextFetchPolicy;
  readonly clientHeaders?: ClientHeaders;
  readonly authentication?: AuthenticationProvider;
  readonly maxResponseBytes?: number;
  readonly maxErrorBodyBytes?: number;
}

export interface NextServerClient<Client extends object> {
  readonly client: Client;
  memoize<Arguments extends readonly unknown[], Result>(
    load: (client: Client, ...arguments_: Arguments) => PromiseLike<Result>,
    key: (...arguments_: Arguments) => string,
  ): (...arguments_: Arguments) => Promise<Result>;
}

function uniqueHeaderNames(names: readonly string[]): readonly string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const sourceName of names) {
    if (!HEADER_NAME.test(sourceName)) {
      throw new ClientRequestError(`Invalid forwarded HTTP header name ${JSON.stringify(sourceName)}`);
    }
    const name = sourceName.toLowerCase();
    if (name === 'cookie') {
      throw new ClientRequestError('Forward cookies through forward.cookies rather than the cookie header');
    }
    if (seen.has(name)) throw new ClientRequestError(`Forwarded HTTP header ${name} is listed more than once`);
    seen.add(name);
    selected.push(name);
  }
  return Object.freeze(selected);
}

function uniqueCookieNames(names: readonly string[]): readonly string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!COOKIE_NAME.test(name)) {
      throw new ClientRequestError(`Invalid forwarded cookie name ${JSON.stringify(name)}`);
    }
    if (seen.has(name)) throw new ClientRequestError(`Forwarded cookie ${name} is listed more than once`);
    seen.add(name);
    selected.push(name);
  }
  return Object.freeze(selected);
}

function forwardedHeaders(source: NextHeaderStore, names: readonly string[]): ClientHeaders {
  const selected: Record<string, string> = {};
  for (const name of uniqueHeaderNames(names)) {
    const value = source.get(name);
    if (value !== null) selected[name] = value;
  }
  return normalizeClientHeaders(selected);
}

function hasInvalidCookieValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x3b || code === 0x7f) return true;
  }
  return false;
}

function forwardedCookieHeader(source: NextCookieStore, names: readonly string[]): string | undefined {
  const selected: string[] = [];
  for (const name of uniqueCookieNames(names)) {
    const cookie = source.get(name);
    if (cookie === undefined) continue;
    if (hasInvalidCookieValue(cookie.value)) {
      throw new ClientRequestError(`Invalid value for forwarded cookie ${name}`);
    }
    selected.push(`${name}=${cookie.value}`);
  }
  return selected.length === 0 ? undefined : selected.join('; ');
}

function requestInit(
  init: Parameters<FetchLike>[1],
  cookie: string | undefined,
  policy: NextFetchPolicy | undefined,
): NextFetchRequestInit {
  const headers =
    cookie === undefined
      ? undefined
      : (() => {
          const selected = new Headers(init?.headers);
          if (selected.has('cookie')) {
            throw new ClientRequestError('Next fetch received two owners for the cookie header');
          }
          selected.set('cookie', cookie);
          return selected;
        })();

  return {
    ...init,
    ...(headers === undefined ? {} : { headers }),
    ...(policy?.cache === undefined ? {} : { cache: policy.cache }),
    ...(policy?.next === undefined ? {} : { next: policy.next }),
  };
}

function requestFetch(fetch: NextFetch, cookie: string | undefined, policy: NextFetchPolicy | undefined): FetchLike {
  return (input, init) => fetch(input, requestInit(init, cookie, policy));
}

export function createNextServerClientFromSources<Client extends object>(
  options: NextServerClientRuntimeOptions<Client>,
  request: NextRequestSources,
): NextServerClient<Client> {
  const forwarded = forwardedHeaders(request.headers, options.forward?.headers ?? []);
  const headers = mergeClientHeaders(options.clientHeaders ?? {}, forwarded);
  const cookie = forwardedCookieHeader(request.cookies, options.forward?.cookies ?? []);
  const transport = createFetchTransport(requestFetch(options.fetch, cookie, options.fetchPolicy));
  const client = options.createClient({
    baseUrl: options.baseUrl,
    transport,
    headers,
    ...(options.authentication === undefined ? {} : { authentication: options.authentication }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
    ...(options.maxErrorBodyBytes === undefined ? {} : { maxErrorBodyBytes: options.maxErrorBodyBytes }),
  });

  return Object.freeze({
    client,
    memoize<Arguments extends readonly unknown[], Result>(
      load: (selectedClient: Client, ...arguments_: Arguments) => PromiseLike<Result>,
      key: (...arguments_: Arguments) => string,
    ): (...arguments_: Arguments) => Promise<Result> {
      const operations = new Map<string, Promise<Result>>();
      return (...arguments_: Arguments): Promise<Result> => {
        const selectedKey = key(...arguments_);
        const present = operations.get(selectedKey);
        if (present !== undefined) return present;
        const operation = Promise.resolve().then(() => load(client, ...arguments_));
        operations.set(selectedKey, operation);
        return operation;
      };
    },
  });
}
