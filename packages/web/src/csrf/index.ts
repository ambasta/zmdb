// @zmdb/web — session-bound CSRF tokens (epic #564, spec ./SPEC.md).
//
// The application supplies the session lookup, allowed browser origins and
// signing secret. Tokens are stateless: this module keeps no session or token
// store, and two instances using the same secret can verify each other's tokens.

import { ChainError, type AnyCtx, type Guard } from '../middleware/index.js';

export interface CsrfOptions {
  readonly secret: Uint8Array<ArrayBuffer>;
  readonly sessionOf: (ctx: AnyCtx) => string | undefined;
  readonly allowedOrigins: readonly string[];
  readonly headerName?: string;
}

export interface Csrf {
  issue(ctx: AnyCtx): Promise<string>;
  verify(ctx: AnyCtx): Promise<void>;
  guard(): Guard;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
const DEFAULT_HEADER = 'x-csrf-token';
const FORBIDDEN = 'forbidden';
const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;
const NONCE_BYTES = 16;
const MAC_BYTES = 32;
const MASK_BYTES = 16;
const NONCE_TEXT_LENGTH = 22;
const MAC_TEXT_LENGTH = 43;
const TOKEN_TEXT_LENGTH = NONCE_TEXT_LENGTH + 1 + MAC_TEXT_LENGTH;
const MASK_TEXT_LENGTH = 22;
const MASKED_TEXT_LENGTH = 88;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

async function importHmacKey(secret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('raw', secret, HMAC, false, ['sign']);
}

async function sign(key: CryptoKey, value: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, value));
}

const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

if (typeof (Uint8Array.prototype as { toBase64?: unknown }).toBase64 !== 'function') {
  (
    Uint8Array.prototype as unknown as {
      toBase64: (this: Uint8Array, options?: { alphabet?: string; omitPadding?: boolean }) => string;
    }
  ).toBase64 = function (this: Uint8Array, options?: { alphabet?: string; omitPadding?: boolean }): string {
    const alphabet = options?.alphabet === 'base64url' ? BASE64URL_CHARS : BASE64_CHARS;
    const omitPadding = options?.omitPadding ?? false;
    let result = '';
    const len = this.length;
    let i = 0;
    while (i < len) {
      const b1 = this[i++] ?? 0;
      const b2 = i < len ? (this[i++] ?? Number.NaN) : Number.NaN;
      const b3 = i < len ? (this[i++] ?? Number.NaN) : Number.NaN;

      const c1 = b1 >> 2;
      const c2 = ((b1 & 3) << 4) | (Number.isNaN(b2) ? 0 : b2 >> 4);
      const c3 = Number.isNaN(b2) ? 64 : ((b2 & 15) << 2) | (Number.isNaN(b3) ? 0 : b3 >> 6);
      const c4 = Number.isNaN(b3) ? 64 : b3 & 63;

      result += alphabet[c1] ?? '';
      result += alphabet[c2] ?? '';
      if (c3 !== 64) result += alphabet[c3] ?? '';
      else if (!omitPadding) result += '=';
      if (c4 !== 64) result += alphabet[c4] ?? '';
      else if (!omitPadding) result += '=';
    }
    return result;
  };
}

if (typeof (Uint8Array as { fromBase64?: unknown }).fromBase64 !== 'function') {
  (
    Uint8Array as unknown as { fromBase64: (string: string, options?: { alphabet?: string }) => Uint8Array }
  ).fromBase64 = function (string: string, options?: { alphabet?: string }): Uint8Array {
    const isUrl = options?.alphabet === 'base64url';
    const alphabet = isUrl ? BASE64URL_CHARS : BASE64_CHARS;
    const lookup = new Int32Array(256).fill(-1);
    for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i) ?? 0] = i;

    const str = string.replace(/=+$/, '');
    const bytes: number[] = [];
    let i = 0;
    while (i < str.length) {
      const charCode1 = str.charCodeAt(i++);
      const c1 = lookup[charCode1] ?? -1;
      const charCode2 = i < str.length ? str.charCodeAt(i++) : 0;
      const c2 = i - 1 < str.length ? (lookup[charCode2] ?? -1) : -1;
      const charCode3 = i < str.length ? str.charCodeAt(i++) : 0;
      const c3 = i - 1 < str.length ? (lookup[charCode3] ?? -1) : -1;
      const charCode4 = i < str.length ? str.charCodeAt(i++) : 0;
      const c4 = i - 1 < str.length ? (lookup[charCode4] ?? -1) : -1;

      if (c1 < 0 || (c2 < 0 && i - 1 < str.length)) throw new SyntaxError('Invalid base64 string');
      const b1 = (c1 << 2) | (c2 >> 4);
      bytes.push(b1);
      if (c3 >= 0) {
        const b2 = ((c2 & 15) << 4) | (c3 >> 2);
        bytes.push(b2);
        if (c4 >= 0) {
          const b3 = ((c3 & 3) << 6) | c4;
          bytes.push(b3);
        }
      }
    }
    return Uint8Array.from(bytes);
  };
}

function encodeBase64Url(value: Uint8Array<ArrayBuffer>): string {
  return value.toBase64({ alphabet: 'base64url', omitPadding: true });
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (value.length === 0 || !BASE64URL.test(value)) {
    return undefined;
  }
  try {
    const decoded = Uint8Array.fromBase64(value, { alphabet: 'base64url' });
    return encodeBase64Url(decoded) === value ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function xorMask(value: Uint8Array<ArrayBuffer>, mask: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    result[index] = (value[index] ?? 0) ^ (mask[index % mask.length] ?? 0);
  }
  return result;
}

function normaliseOrigins(origins: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new TypeError('allowedOrigins must contain at least one explicit HTTP(S) origin');
  }
  const normalised = new Set<string>();
  for (const candidate of origins) {
    if (typeof candidate !== 'string' || candidate.includes('*')) {
      throw new TypeError('allowedOrigins must contain explicit HTTP(S) origins');
    }
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new TypeError('allowedOrigins must contain valid absolute URLs');
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin === 'null' ||
      url.username !== '' ||
      url.password !== '' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new TypeError('allowedOrigins entries must be origins, not URL patterns or paths');
    }
    normalised.add(url.origin);
  }
  return normalised;
}

function normaliseHeaderName(name: string | undefined): string {
  const normalised = name ?? DEFAULT_HEADER;
  if (normalised.length === 0 || !HEADER_NAME.test(normalised)) {
    throw new TypeError('headerName must be a valid HTTP field name');
  }
  return normalised.toLowerCase();
}

function header(headers: Readonly<Record<string, string>>, wanted: string): string | undefined {
  const direct = headers[wanted];
  if (direct !== undefined) {
    return direct;
  }
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === wanted) {
      return headers[name];
    }
  }
  return undefined;
}

function requestOrigin(ctx: AnyCtx): string | undefined {
  const candidate = header(ctx.headers, 'origin') ?? header(ctx.headers, 'referer');
  if (candidate === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.origin === 'null' ? undefined : parsed.origin;
  } catch {
    return undefined;
  }
}

function sessionFor(ctx: AnyCtx, sessionOf: CsrfOptions['sessionOf']): string {
  const session = sessionOf(ctx);
  if (session === undefined) {
    throw new Error('CSRF protection requires a cookie-backed session');
  }
  return session;
}

function rejectRequest(): never {
  throw new ChainError(403, FORBIDDEN);
}

async function equalAfterMac(
  key: CryptoKey,
  expected: Uint8Array<ArrayBuffer>,
  provided: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const [expectedDigest, providedDigest] = await Promise.all([sign(key, expected), sign(key, provided)]);
  return encodeBase64Url(expectedDigest) === encodeBase64Url(providedDigest);
}

interface ParsedToken {
  readonly nonce: string;
  readonly mac: Uint8Array<ArrayBuffer>;
}

function parseToken(token: string): ParsedToken | undefined {
  const segments = token.split('.');
  if (segments.length !== 2 || segments[0]?.length !== MASK_TEXT_LENGTH || segments[1]?.length !== MASKED_TEXT_LENGTH) {
    return undefined;
  }
  const mask = decodeBase64Url(segments[0]);
  const masked = decodeBase64Url(segments[1]);
  if (mask?.byteLength !== MASK_BYTES || masked?.byteLength !== TOKEN_TEXT_LENGTH) {
    return undefined;
  }

  let raw: string;
  try {
    raw = decoder.decode(xorMask(masked, mask));
  } catch {
    return undefined;
  }
  const tokenParts = raw.split('.');
  if (
    tokenParts.length !== 2 ||
    tokenParts[0]?.length !== NONCE_TEXT_LENGTH ||
    tokenParts[1]?.length !== MAC_TEXT_LENGTH
  ) {
    return undefined;
  }
  const nonceBytes = decodeBase64Url(tokenParts[0]);
  const mac = decodeBase64Url(tokenParts[1]);
  if (nonceBytes?.byteLength !== NONCE_BYTES || mac?.byteLength !== MAC_BYTES) {
    return undefined;
  }
  return { nonce: tokenParts[0], mac };
}

/** Create stateless CSRF protection for a cookie-authenticated application. */
export async function createCsrf(options: CsrfOptions): Promise<Csrf> {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('CSRF options are required');
  }
  if (!(options.secret instanceof Uint8Array) || options.secret.byteLength === 0) {
    throw new TypeError('secret must be a non-empty Uint8Array');
  }
  if (typeof options.sessionOf !== 'function') {
    throw new TypeError('sessionOf is required');
  }

  const allowedOrigins = normaliseOrigins(options.allowedOrigins);
  const headerName = normaliseHeaderName(options.headerName);
  const sessionOf = options.sessionOf;
  const signingKey = await importHmacKey(options.secret.slice());
  const comparisonKey = await importHmacKey(randomBytes(MAC_BYTES));

  const issue = async (ctx: AnyCtx): Promise<string> => {
    const session = sessionFor(ctx, sessionOf);
    const nonce = encodeBase64Url(randomBytes(NONCE_BYTES));
    const mac = await sign(signingKey, encoder.encode(`${session}.${nonce}`));
    const raw = encoder.encode(`${nonce}.${encodeBase64Url(mac)}`);
    const mask = randomBytes(MASK_BYTES);
    return `${encodeBase64Url(mask)}.${encodeBase64Url(xorMask(raw, mask))}`;
  };

  const verify = async (ctx: AnyCtx): Promise<void> => {
    const session = sessionFor(ctx, sessionOf);
    if (SAFE_METHODS.has(ctx.method)) {
      return;
    }

    const origin = requestOrigin(ctx);
    if (origin === undefined || !allowedOrigins.has(origin)) {
      rejectRequest();
    }

    const supplied = header(ctx.headers, headerName);
    const parsed = supplied === undefined ? undefined : parseToken(supplied);
    if (parsed === undefined) {
      rejectRequest();
    }

    const expected = await sign(signingKey, encoder.encode(`${session}.${parsed.nonce}`));
    if (!(await equalAfterMac(comparisonKey, expected, parsed.mac))) {
      rejectRequest();
    }
  };

  const guard = (): Guard => ({
    async canActivate(ctx: AnyCtx): Promise<boolean> {
      try {
        await verify(ctx);
        return true;
      } catch (error) {
        if (error instanceof ChainError && error.status === 403) {
          return false;
        }
        throw error;
      }
    },
  });

  return Object.freeze({ issue, verify, guard });
}
