import type { RequestEvent, ServerLoadEvent } from '@sveltejs/kit';
import { createFetchTransport } from '@zmdb/client';
import type { ClientOptions } from '@zmdb/client';

import { SvelteKitAdapterError } from './errors.js';
import type { GeneratedClientFactory } from './shared.js';

export { SvelteKitAdapterError } from './errors.js';
export type { GeneratedClientFactory, SvelteKitClientOptions } from './shared.js';

export type SvelteKitRequestEvent = Pick<RequestEvent, 'cookies' | 'fetch' | 'request'>;

export type SvelteKitServerLoadEvent = SvelteKitRequestEvent & Pick<ServerLoadEvent, 'depends'>;

export interface SvelteKitForwarding {
  readonly headers?: readonly string[];
  readonly cookies?: readonly string[];
}

export interface SvelteKitServerClientOptions extends Omit<ClientOptions, 'transport'> {
  readonly forward?: SvelteKitForwarding;
}

export interface SvelteKitServerLoadDefinition<Client, Event extends SvelteKitServerLoadEvent, Output> {
  readonly key: `${string}:${string}`;
  readonly createClient: GeneratedClientFactory<Client>;
  readonly clientOptions: SvelteKitServerClientOptions;
  readonly load: (client: Client, event: Event, signal: AbortSignal) => PromiseLike<Output>;
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function uniqueHeaderNames(names: readonly string[]): readonly string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const candidate of names) {
    const probe = new Headers();
    probe.set(candidate, 'probe');
    const name = candidate.toLowerCase();
    if (name === 'cookie' || name === 'set-cookie') {
      throw new SvelteKitAdapterError(`@zmdb/sveltekit forwards ${name} only through the explicit cookie allow-list`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      selected.push(name);
    }
  }
  return Object.freeze(selected);
}

function uniqueCookieNames(names: readonly string[]): readonly string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!COOKIE_NAME.test(name)) {
      throw new SvelteKitAdapterError(`@zmdb/sveltekit cannot forward invalid cookie name ${JSON.stringify(name)}`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      selected.push(name);
    }
  }
  return Object.freeze(selected);
}

function outgoingHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers !== undefined) {
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  }
  return headers;
}

function setForwardedHeader(headers: Headers, name: string, value: string): void {
  const existing = headers.get(name);
  if (existing !== null && existing !== value) {
    throw new SvelteKitAdapterError(
      `@zmdb/sveltekit refused to replace generated-client header ${name} while forwarding the request event`,
    );
  }
  headers.set(name, value);
}

function selectedCookieHeader(event: SvelteKitRequestEvent, names: readonly string[]): string {
  const pairs: string[] = [];
  for (const name of names) {
    const value = event.cookies.get(name);
    if (value !== undefined) pairs.push(`${name}=${encodeURIComponent(value)}`);
  }
  return pairs.join('; ');
}

export function createSvelteKitServerFetch(
  event: SvelteKitRequestEvent,
  forwarding: SvelteKitForwarding = {},
): typeof globalThis.fetch {
  const headerNames = uniqueHeaderNames(forwarding.headers ?? []);
  const cookieNames = uniqueCookieNames(forwarding.cookies ?? []);

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = outgoingHeaders(input, init);
    for (const name of headerNames) {
      const value = event.request.headers.get(name);
      if (value !== null) setForwardedHeader(headers, name, value);
    }
    const cookie = selectedCookieHeader(event, cookieNames);
    if (cookie !== '') setForwardedHeader(headers, 'cookie', cookie);

    return event.fetch(input, {
      ...init,
      credentials: 'omit',
      headers,
    });
  };

  return fetch;
}

export function createSvelteKitServerClient<Client>(
  event: SvelteKitRequestEvent,
  createClient: GeneratedClientFactory<Client>,
  options: SvelteKitServerClientOptions,
): Client {
  const { forward, ...clientOptions } = options;
  return createClient({
    ...clientOptions,
    transport: createFetchTransport(createSvelteKitServerFetch(event, forward)),
  });
}

export function createSvelteKitServerLoad<Client, Event extends SvelteKitServerLoadEvent, Output>(
  definition: SvelteKitServerLoadDefinition<Client, Event, Output>,
): (event: Event) => Promise<Output> {
  if (!definition.key.includes(':')) {
    throw new SvelteKitAdapterError('@zmdb/sveltekit server load keys must contain a namespace prefix');
  }

  return async event => {
    event.depends(definition.key);
    const client = createSvelteKitServerClient(event, definition.createClient, definition.clientOptions);
    return definition.load(client, event, event.request.signal);
  };
}
