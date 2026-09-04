// @zmdb/web — incremental response compression (epic #564, issue #568).
//
// Application compression is the fallback for deployments without a proxy or
// CDN. It is intentionally limited to the cross-runtime CompressionStream
// formats: gzip and deflate, never Node-only brotli.

import type { AnyCtx, Interceptor } from '../middleware/index.js';
import type { ResponseBody, WebResponse } from '../pipeline/index.js';

export type ContentCoding = 'gzip' | 'deflate';

export interface CompressionOptions {
  readonly minBytes?: number;
  readonly types?: readonly string[];
  readonly skip?: (response: WebResponse, ctx: AnyCtx) => boolean;
}

const DEFAULT_MIN_BYTES = 1024;
const DEFAULT_TYPES = Object.freeze([
  'text/*',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/xhtml+xml',
  'image/svg+xml',
  '*+json',
  '*+xml',
]);
const CODINGS: readonly ContentCoding[] = ['gzip', 'deflate'];

interface Negotiated {
  readonly coding: ContentCoding | undefined;
  readonly identityAllowed: boolean;
}

/** Negotiate and incrementally compress one response. */
export function compress(response: WebResponse, ctx: AnyCtx, options: CompressionOptions = {}): WebResponse {
  const headers = withVary(response.headers);
  const existing = header(headers, 'content-encoding');
  if (existing !== undefined) {
    return replaceResponse(response, response.status, response.body, headers);
  }

  const negotiated = negotiate(header(ctx.headers, 'accept-encoding'));
  if (negotiated.coding === undefined && !negotiated.identityAllowed) {
    return replaceResponse(response, 406, { kind: 'text', value: '' }, withoutHeader(headers, 'content-length'));
  }

  if (
    negotiated.coding === undefined ||
    response.status < 200 ||
    response.status === 204 ||
    response.status === 304 ||
    ctx.method.toUpperCase() === 'HEAD' ||
    !compressibleType(header(headers, 'content-type'), options.types ?? DEFAULT_TYPES) ||
    belowThreshold(response.body, options.minBytes ?? DEFAULT_MIN_BYTES) ||
    options.skip?.(response, ctx) === true
  ) {
    return replaceResponse(response, response.status, response.body, headers);
  }

  // BREACH: do not compress a body that combines a long-lived secret with
  // attacker-controlled text. The framework cannot infer either fact; skip()
  // is the explicit per-response veto.
  const source = bodyStream(response.body);
  const value = source.pipeThrough(new CompressionStream(negotiated.coding));
  const compressedHeaders = {
    ...withoutHeader(headers, 'content-length'),
    'content-encoding': negotiated.coding,
  };
  return replaceResponse(response, response.status, { kind: 'stream', value, length: undefined }, compressedHeaders);
}

/** The middleware form is deliberately a thin wrapper around the pure function. */
export function compressionInterceptor(options: CompressionOptions = {}): Interceptor {
  return {
    async intercept(ctx: AnyCtx, next: () => Promise<unknown>): Promise<unknown> {
      const result = await next();
      return isWebResponse(result) ? compress(result, ctx, options) : result;
    },
  };
}

function negotiate(value: string | undefined): Negotiated {
  if (value === undefined) {
    return { coding: undefined, identityAllowed: true };
  }

  const qualities = new Map<string, number>();
  for (const item of value.split(',')) {
    const parts = item.split(';');
    const coding = (parts.shift() ?? '').trim().toLowerCase();
    if (coding.length === 0) {
      continue;
    }
    let quality = 1;
    for (const parameter of parts) {
      const separator = parameter.indexOf('=');
      if (separator === -1 || parameter.slice(0, separator).trim().toLowerCase() !== 'q') {
        continue;
      }
      quality = parseQuality(parameter.slice(separator + 1).trim());
    }
    const previous = qualities.get(coding);
    qualities.set(coding, previous === 0 || quality === 0 ? 0 : Math.max(previous ?? 0, quality));
  }

  const wildcard = qualities.get('*');
  let selected: ContentCoding | undefined;
  let selectedQuality = 0;
  for (const coding of CODINGS) {
    const quality = qualities.get(coding) ?? wildcard ?? 0;
    if (quality > selectedQuality) {
      selected = coding;
      selectedQuality = quality;
    }
  }

  const explicitIdentity = qualities.get('identity');
  const identityAllowed = explicitIdentity === undefined ? wildcard !== 0 : explicitIdentity > 0;
  return { coding: selectedQuality > 0 ? selected : undefined, identityAllowed };
}

function parseQuality(value: string): number {
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) {
    return 0;
  }
  return Number(value);
}

function compressibleType(contentType: string | undefined, allowed: readonly string[]): boolean {
  if (contentType === undefined) {
    return false;
  }
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  for (const entry of allowed) {
    const pattern = entry.trim().toLowerCase();
    if (pattern === mediaType) {
      return true;
    }
    if (pattern.endsWith('/*') && mediaType.startsWith(pattern.slice(0, -1))) {
      return true;
    }
    if (pattern.startsWith('*+') && mediaType.endsWith(pattern.slice(1))) {
      return true;
    }
  }
  return false;
}

function belowThreshold(body: ResponseBody, minimum: number): boolean {
  switch (body.kind) {
    case 'text':
      return new TextEncoder().encode(body.value).byteLength < minimum;
    case 'bytes':
      return body.value.byteLength < minimum;
    case 'stream':
      return body.length !== undefined && body.length < minimum;
  }
}

function bodyStream(body: ResponseBody): ReadableStream<Uint8Array<ArrayBuffer>> {
  if (body.kind === 'stream') {
    return body.value;
  }
  const chunk = body.kind === 'text' ? new TextEncoder().encode(body.value) : body.value;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
}

function withVary(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const existing = header(headers, 'vary');
  const values =
    existing === undefined
      ? []
      : existing
          .split(',')
          .map(value => value.trim())
          .filter(value => value.length > 0);
  if (!values.some(value => value.toLowerCase() === 'accept-encoding')) {
    values.push('accept-encoding');
  }
  return { ...withoutHeader(headers, 'vary'), vary: values.join(', ') };
}

function withoutHeader(headers: Readonly<Record<string, string>>, unwanted: string): Readonly<Record<string, string>> {
  let found = false;
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === unwanted) {
      found = true;
      break;
    }
  }
  if (!found) {
    return headers;
  }
  const result: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() !== unwanted) {
      result[name] = headers[name] ?? '';
    }
  }
  return result;
}

function header(headers: Readonly<Record<string, string>>, wanted: string): string | undefined {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === wanted) {
      return headers[name];
    }
  }
  return undefined;
}

/**
 * Clone every own property descriptor before replacing the public response
 * fields. This preserves the pipeline's non-enumerable response marker without
 * exporting or duplicating that private symbol.
 */
function replaceResponse(
  response: WebResponse,
  status: number,
  body: ResponseBody,
  headers: Readonly<Record<string, string>>,
): WebResponse {
  const clone: WebResponse = Object.create(Object.getPrototypeOf(response));
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(response));
  Object.defineProperties(clone, {
    status: { configurable: true, enumerable: true, value: status, writable: true },
    body: { configurable: true, enumerable: true, value: body, writable: true },
    headers: { configurable: true, enumerable: true, value: headers, writable: true },
  });
  return clone;
}

function isWebResponse(value: unknown): value is WebResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const status = Reflect.get(value, 'status');
  const headers = Reflect.get(value, 'headers');
  const body = Reflect.get(value, 'body');
  return (
    typeof status === 'number' &&
    typeof headers === 'object' &&
    headers !== null &&
    typeof body === 'object' &&
    body !== null &&
    typeof Reflect.get(body, 'kind') === 'string'
  );
}
