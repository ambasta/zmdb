import { createFetchTransport } from '@zmdb/client';
import type { ClientRequest, ClientTransport } from '@zmdb/client';
import type { FetchLike } from '@zmdb/client/transport';
import type { App } from 'vue';

import type { NuxtGeneratedClientFactory, ZmdbNuxtBindings } from '../client/index.js';
import { normalizeForwardNames } from '../forwarding.js';

export interface ZmdbNuxtForwardingOptions {
  readonly forwardHeaders?: readonly string[];
  readonly forwardCookies?: readonly string[];
}

export interface ZmdbNuxtServerPluginOptions extends ZmdbNuxtForwardingOptions {
  readonly baseUrl: string | URL;
  readonly fetch: FetchLike;
}

export interface NuxtServerApplication {
  readonly vueApp: Pick<App, 'use'>;
  readonly ssrContext?: {
    readonly event?: unknown;
  };
}

interface NuxtRequestEvent {
  readonly headers: Headers;
}

function cookiePairs(value: string | null | undefined): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  for (const segment of value?.split(';') ?? []) {
    const separator = segment.indexOf('=');
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name.length === 0 || pairs.has(name)) continue;
    pairs.set(name, segment.slice(separator + 1).trim());
  }
  return pairs;
}

function selectedCookieHeader(
  incoming: ReadonlyMap<string, string>,
  names: readonly string[],
  operationCookie: string | undefined,
): string | undefined {
  const selected = new Map<string, string>();
  for (const name of names) {
    const value = incoming.get(name);
    if (value !== undefined) selected.set(name, value);
  }
  for (const [name, value] of cookiePairs(operationCookie)) selected.set(name, value);
  if (selected.size === 0) return undefined;
  return [...selected].map(([name, value]) => `${name}=${value}`).join('; ');
}

function forwardedHeaders(incoming: Headers, names: readonly string[]): Headers {
  const selected = new Headers();
  for (const name of names) {
    const value = incoming.get(name);
    if (value !== null) selected.set(name, value);
  }
  return selected;
}

function requestInit(init: RequestInit | undefined, forwarded: Headers, cookie: string | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  forwarded.forEach((value, name) => {
    if (!headers.has(name)) headers.set(name, value);
  });
  if (cookie !== undefined && !headers.has('cookie')) headers.set('cookie', cookie);
  return init === undefined ? { headers } : { ...init, headers };
}

function withoutCookie(request: ClientRequest): ClientRequest {
  if (request.headers.cookie === undefined) return request;
  const headers = Object.freeze(
    Object.fromEntries(Object.entries(request.headers).filter(([name]) => name !== 'cookie')),
  );
  return Object.freeze({
    ...request,
    headers,
  });
}

function requestEvent(value: unknown): NuxtRequestEvent {
  if (typeof value !== 'object' || value === null || !('headers' in value)) {
    throw new Error('@zmdb/nuxt server plugin requires the current Nitro request event');
  }
  const headers = value.headers;
  if (!(headers instanceof Headers)) {
    throw new Error('@zmdb/nuxt server plugin requires the current Nitro request event');
  }
  return Object.freeze({ headers });
}

export function createNuxtServerTransport(
  fetch: FetchLike,
  incomingHeaders: Headers,
  options: ZmdbNuxtForwardingOptions = {},
): ClientTransport {
  const headerNames = normalizeForwardNames(options.forwardHeaders, 'header');
  const cookieNames = normalizeForwardNames(options.forwardCookies, 'cookie');
  const forwarded = forwardedHeaders(incomingHeaders, headerNames);
  const incomingCookies = cookiePairs(incomingHeaders.get('cookie'));

  return request => {
    const cookie = selectedCookieHeader(incomingCookies, cookieNames, request.headers.cookie);
    const requestFetch: FetchLike = (input, init) => fetch(input, requestInit(init, forwarded, cookie));
    return createFetchTransport(requestFetch)(withoutCookie(request));
  };
}

export function createZmdbNuxtServerPlugin<Client extends object>(
  bindings: Pick<ZmdbNuxtBindings<Client>, 'createZmdbPlugin'>,
  createClient: NuxtGeneratedClientFactory<Client>,
  options: ZmdbNuxtServerPluginOptions,
): (nuxtApp: NuxtServerApplication) => void {
  return nuxtApp => {
    const event = requestEvent(nuxtApp.ssrContext?.event);
    const transport = createNuxtServerTransport(options.fetch, event.headers, options);
    const client = createClient({
      baseUrl: options.baseUrl,
      transport,
    });
    nuxtApp.vueApp.use(bindings.createZmdbPlugin(client));
  };
}
