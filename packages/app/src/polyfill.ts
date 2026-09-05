// Zero-dependency Symbol.metadata and Uint8Array.prototype.toBase64 baseline.
//
// Stage-3 decorator metadata relies on the well-known `Symbol.metadata`. Node 26
// / V8 does not yet expose it (`Symbol.metadata === undefined` as of v26.8), so
// we install it if — and only if — the runtime lacks it. We assign ONLY the
// well-known symbol and mutate nothing else on any global. When a future runtime
// ships it natively this becomes a no-op.
//
// This module has a side effect and must be imported before any decorated class
// is evaluated. `@zmdb/app`'s entry imports it first.

interface SymbolWithMetadata {
  metadata?: symbol;
}

const carrier: SymbolWithMetadata = Symbol;
if (carrier.metadata === undefined) {
  Object.defineProperty(Symbol, 'metadata', {
    value: Symbol.for('Symbol.metadata'),
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64(bytes: Uint8Array, alphabet: 'base64' | 'base64url', omitPadding: boolean): string {
  const chars = alphabet === 'base64url' ? BASE64URL_CHARS : BASE64_CHARS;
  let result = '';
  const len = bytes.length;
  let i = 0;
  for (; i < len - 2; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    if (b0 === undefined || b1 === undefined || b2 === undefined) {
      break;
    }
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += chars[((b1 & 15) << 2) | (b2 >> 6)];
    result += chars[b2 & 63];
  }
  if (i < len) {
    const b0 = bytes[i];
    if (b0 !== undefined) {
      result += chars[b0 >> 2];
      const b1 = bytes[i + 1];
      if (b1 !== undefined) {
        result += chars[((b0 & 3) << 4) | (b1 >> 4)];
        result += chars[(b1 & 15) << 2];
        if (!omitPadding && alphabet === 'base64') {
          result += '=';
        }
      } else {
        result += chars[(b0 & 3) << 4];
        if (!omitPadding && alphabet === 'base64') {
          result += '==';
        }
      }
    }
  }
  if (!omitPadding && alphabet === 'base64url') {
    while (result.length % 4 !== 0) {
      result += '=';
    }
  }
  return result;
}

const proto: { toBase64?: unknown } = Uint8Array.prototype;
if (!('toBase64' in proto)) {
  Object.defineProperty(proto, 'toBase64', {
    value: function (this: Uint8Array, options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }) {
      return encodeBase64(this, options?.alphabet ?? 'base64', options?.omitPadding ?? false);
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

function decodeBase64(string: string, alphabet: 'base64' | 'base64url' = 'base64'): Uint8Array {
  let str = string;
  if (alphabet === 'base64url') {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
  }
  while (str.length % 4 !== 0) {
    str += '=';
  }
  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(str, 'base64'));
  }
  const binary = globalThis.atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const uint8ArrayCarrier: { fromBase64?: unknown } = Uint8Array;
if (!('fromBase64' in uint8ArrayCarrier)) {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: function (string: string, options?: { alphabet?: 'base64' | 'base64url' }) {
      return decodeBase64(string, options?.alphabet ?? 'base64');
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
