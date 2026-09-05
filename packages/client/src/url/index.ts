import { ClientRequestError } from '../errors/index.js';
import type { ClientQueryPair } from '../types.js';

export type ClientScalar = string | number | bigint | boolean | Date;

export type ClientBaseUrl =
  | { readonly kind: 'absolute'; readonly origin: string; readonly pathname: string }
  | { readonly kind: 'relative'; readonly pathname: string };

const CONTROL = /[\0\r\n]/;

function requestError(message: string, cause?: unknown): ClientRequestError {
  return new ClientRequestError(message, cause === undefined ? {} : { cause });
}

function prefixPath(pathname: string): string {
  const withoutTrailing = pathname.replace(/\/+$/u, '');
  return withoutTrailing.length === 0 ? '/' : withoutTrailing;
}

export function normalizeClientBaseUrl(input: string | URL): ClientBaseUrl {
  if (input instanceof URL) {
    if (input.protocol !== 'http:' && input.protocol !== 'https:') {
      throw requestError(`Client base URL protocol must be http: or https:, received ${input.protocol}`);
    }
    if (input.username.length > 0 || input.password.length > 0) {
      throw requestError('Client base URL must not contain credentials');
    }
    if (input.search.length > 0 || input.hash.length > 0) {
      throw requestError('Client base URL must not contain a query or fragment');
    }
    return Object.freeze({ kind: 'absolute', origin: input.origin, pathname: prefixPath(input.pathname) });
  }

  if (typeof input !== 'string' || input.length === 0 || CONTROL.test(input)) {
    throw requestError('Client base URL must be a non-empty absolute or origin-relative URL');
  }
  if (input.startsWith('/') && !input.startsWith('//')) {
    if (input.includes('?') || input.includes('#')) {
      throw requestError('Client base URL must not contain a query or fragment');
    }
    return Object.freeze({ kind: 'relative', pathname: prefixPath(input) });
  }

  let absolute: URL;
  try {
    absolute = new URL(input);
  } catch (error) {
    throw requestError('Client base URL must be absolute or begin with /', error);
  }
  return normalizeClientBaseUrl(absolute);
}

export function stringifyClientScalar(value: ClientScalar): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw requestError('Client URL scalar number must be finite');
    return String(value);
  }
  if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (Number.isNaN(value.getTime())) throw requestError('Client URL scalar Date must be valid');
  return value.toISOString();
}

export function encodeClientComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, character => {
    const code = character.codePointAt(0);
    return code === undefined ? '' : `%${code.toString(16).toUpperCase()}`;
  });
}

export function substituteClientPath(path: string, name: string, value: ClientScalar): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || CONTROL.test(path)) {
    throw requestError('Client operation path must begin with / and contain no query, fragment, or controls');
  }
  const slot = `:${name}`;
  const segments = path.split('/');
  const indexes = segments.flatMap((segment, index) => (segment === slot ? [index] : []));
  if (indexes.length !== 1) {
    throw requestError(`Client operation path must contain exactly one ${slot} segment`);
  }
  const index = indexes[0];
  if (index === undefined) throw requestError(`Client operation path is missing ${slot}`);
  segments[index] = encodeClientComponent(stringifyClientScalar(value));
  return segments.join('/');
}

export function serializeClientQuery(query: readonly ClientQueryPair[]): string {
  return query
    .map(pair => {
      if (typeof pair.name !== 'string' || typeof pair.value !== 'string') {
        throw requestError('Client query pairs must contain string names and values');
      }
      return `${encodeClientComponent(pair.name)}=${encodeClientComponent(pair.value)}`;
    })
    .join('&');
}

export function resolveClientUrl(
  baseUrl: string | URL | ClientBaseUrl,
  path: string,
  query: readonly ClientQueryPair[] = [],
): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || CONTROL.test(path)) {
    throw requestError('Prepared client path must begin with / and contain no query, fragment, or controls');
  }
  const base = typeof baseUrl === 'string' || baseUrl instanceof URL ? normalizeClientBaseUrl(baseUrl) : baseUrl;
  const prefix = base.pathname === '/' ? '' : base.pathname;
  const pathname = `${prefix}${path}` || '/';
  const serialized = serializeClientQuery(query);
  const result = serialized.length === 0 ? pathname : `${pathname}?${serialized}`;
  return base.kind === 'absolute' ? `${base.origin}${result}` : result;
}
