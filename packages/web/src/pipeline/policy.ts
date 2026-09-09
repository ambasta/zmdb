// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { WebRequest, WebResponse } from './index.js';

/** Browser access policy; this does not authorize application operations. */
export interface CorsPolicy {
  readonly origins: '*' | readonly string[] | ((origin: string) => boolean);
  readonly credentials?: boolean;
  readonly methods?: readonly string[];
  readonly headers?: readonly string[];
  readonly exposeHeaders?: readonly string[];
  readonly maxAgeSeconds?: number;
}

export interface HttpPolicy {
  readonly cors?: false | CorsPolicy;
  /** Configured values override application headers; false preserves the application value. */
  readonly securityHeaders?: Readonly<Record<string, string | false>>;
}

export interface NormalizedPolicy {
  preflight(method: string, headers: WebRequest['headers']): WebResponse | undefined;
  decorate(headers: WebRequest['headers'], response: WebResponse): WebResponse;
}

function header(headers: WebRequest['headers'], name: string): string | undefined {
  return headers[name] ?? Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

function tokens(values: readonly string[], upper = false): readonly string[] {
  return [
    ...new Set(
      values.map(value => {
        // Header names and HTTP methods both use the HTTP token grammar.
        const validated = new Headers([[value, '']]);
        const name = [...validated.keys()][0] ?? value;
        return upper ? name.toUpperCase() : name;
      }),
    ),
  ];
}

function vary(headers: Headers, names: readonly string[]): void {
  const current = (headers.get('vary') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const seen = new Set(current.map(value => value.toLowerCase()));
  if (seen.has('*')) return;
  for (const name of names) {
    if (!seen.has(name.toLowerCase())) {
      current.push(name);
      seen.add(name.toLowerCase());
    }
  }
  headers.set('vary', current.join(', '));
}

export function normalizePolicy(policy: HttpPolicy | undefined): NormalizedPolicy | undefined {
  if (policy === undefined) return undefined;
  const fixed = new Headers();
  for (const [name, value] of Object.entries(policy.securityHeaders ?? {})) {
    const validated = new Headers([[name, value === false ? '' : value]]);
    if (value !== false) for (const [key, headerValue] of validated) fixed.set(key, headerValue);
  }
  const cors = policy.cors || undefined;
  if (cors === undefined && [...fixed].length === 0) return undefined;
  if (cors?.origins === '*' && cors.credentials === true) {
    throw new TypeError('credentialed CORS requires explicit origins or an origin predicate');
  }
  const credentials = cors?.credentials === true;
  const origins = cors?.origins;
  const originSet = Array.isArray(origins) ? new Set(origins) : undefined;
  const accepts = (origin: string): boolean =>
    origins === '*' || (typeof origins === 'function' ? origins(origin) : originSet?.has(origin) === true);
  const methods = tokens(cors?.methods ?? ['GET', 'HEAD', 'POST'], true);
  const allowedMethods = new Set(methods);
  const allowedHeadersList = tokens(cors?.headers ?? []);
  const allowedHeaders = new Set(allowedHeadersList);
  const exposed = tokens(cors?.exposeHeaders ?? []).join(', ');
  const maxAge = cors?.maxAgeSeconds;
  if (maxAge !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 0))
    throw new RangeError('maxAgeSeconds must be a non-negative safe integer');
  const preflightHeaders = new Headers();
  preflightHeaders.set('access-control-allow-methods', methods.join(', '));
  if (allowedHeadersList.length > 0)
    preflightHeaders.set('access-control-allow-headers', allowedHeadersList.join(', '));
  if (maxAge !== undefined) preflightHeaders.set('access-control-max-age', String(maxAge));

  function decorate(
    response: WebResponse,
    origin: string | undefined,
    allowed: boolean,
    preflight: boolean,
  ): WebResponse {
    const headers = new Headers(response.headers);
    if (cors !== undefined) {
      for (const name of [
        'access-control-allow-origin',
        'access-control-allow-credentials',
        'access-control-expose-headers',
        'access-control-allow-methods',
        'access-control-allow-headers',
        'access-control-max-age',
      ])
        headers.delete(name);
      vary(
        headers,
        preflight ? ['Origin', 'Access-Control-Request-Method', 'Access-Control-Request-Headers'] : ['Origin'],
      );
      if (allowed && origin !== undefined) {
        headers.set('access-control-allow-origin', origins === '*' ? '*' : origin);
        if (credentials) headers.set('access-control-allow-credentials', 'true');
        if (exposed) headers.set('access-control-expose-headers', exposed);
        if (preflight) for (const [name, value] of preflightHeaders) headers.set(name, value);
      }
    }
    for (const [name, value] of fixed) headers.set(name, value);
    return { ...response, headers: Object.fromEntries(headers) };
  }

  return {
    preflight(method, headers) {
      const origin = header(headers, 'origin');
      const requestedMethod = header(headers, 'access-control-request-method');
      if (cors === undefined || method.toUpperCase() !== 'OPTIONS' || !origin || !requestedMethod) return undefined;
      const requestedHeaders = (header(headers, 'access-control-request-headers') ?? '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
      const originAllowed = accepts(origin);
      const allowed =
        originAllowed &&
        allowedMethods.has(requestedMethod.toUpperCase()) &&
        requestedHeaders.every(name => allowedHeaders.has(name));
      return decorate(
        { status: allowed ? 204 : 403, body: { kind: 'text', value: '' }, headers: {} },
        origin,
        allowed,
        true,
      );
    },
    decorate(headers, response) {
      const origin = header(headers, 'origin');
      return decorate(response, origin, cors !== undefined && origin !== undefined && accepts(origin), false);
    },
  };
}
