export type ZmdbNuxtForwardNameKind = 'header' | 'cookie';

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const RESERVED_FORWARD_HEADERS = new Set([
  'accept',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'transfer-encoding',
]);

export function normalizeForwardNames(
  values: readonly string[] | undefined,
  kind: ZmdbNuxtForwardNameKind,
): readonly string[] {
  const selected = values ?? [];
  const normalized = selected.map(value => (kind === 'header' ? value.trim().toLowerCase() : value.trim()));
  const pattern = kind === 'header' ? HEADER_NAME : COOKIE_NAME;
  for (const value of normalized) {
    if (!pattern.test(value)) {
      throw new Error(`@zmdb/nuxt forward ${kind} name ${JSON.stringify(value)} is invalid`);
    }
    if (kind === 'header' && RESERVED_FORWARD_HEADERS.has(value)) {
      throw new Error(`@zmdb/nuxt forward header ${value} is transport-owned; use forwardCookies for cookies`);
    }
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`@zmdb/nuxt forward ${kind} names must not contain duplicates`);
  }
  return Object.freeze(normalized);
}
