import { ClientRequestError } from '../errors/index.js';
import type { ClientHeaders } from '../types.js';

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const INVALID_VALUE = /[\0\r\n]/;

export const TRANSPORT_OWNED_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function normalizeClientHeaders(headers: ClientHeaders = {}): ClientHeaders {
  const normalized: Record<string, string> = {};
  for (const [sourceName, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(sourceName)) {
      throw new ClientRequestError(`Invalid HTTP header name ${JSON.stringify(sourceName)}`);
    }
    if (typeof value !== 'string' || INVALID_VALUE.test(value)) {
      throw new ClientRequestError(`Invalid value for HTTP header ${sourceName.toLowerCase()}`);
    }
    const name = sourceName.toLowerCase();
    const present = normalized[name];
    if (present !== undefined && present !== value) {
      throw new ClientRequestError(`Conflicting values for HTTP header ${name}`);
    }
    normalized[name] = value;
  }
  return Object.freeze(normalized);
}

export function mergeClientHeaders(...sources: readonly ClientHeaders[]): ClientHeaders {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    for (const [name, value] of Object.entries(normalizeClientHeaders(source))) {
      const present = merged[name];
      if (present !== undefined && present !== value) {
        throw new ClientRequestError(`Conflicting values for HTTP header ${name}`);
      }
      merged[name] = value;
    }
  }
  return Object.freeze(merged);
}

export function assertNoTransportOwnedHeaders(headers: ClientHeaders): void {
  for (const name of Object.keys(headers)) {
    if (TRANSPORT_OWNED_HEADERS.has(name.toLowerCase())) {
      throw new ClientRequestError(`HTTP header ${name.toLowerCase()} is owned by the transport`);
    }
  }
}
