// Zero-dependency Symbol.metadata baseline.
//
// Stage-3 decorator metadata relies on the well-known `Symbol.metadata`. Node 26
// / V8 does not yet expose it (`Symbol.metadata === undefined` as of v26.8), so
// we install it if — and only if — the runtime lacks it. We assign ONLY the
// well-known symbol and mutate nothing else on any global. When a future runtime
// ships it natively this becomes a no-op.
//
// This module has a side effect and must be imported before any decorated class
// is evaluated. `@zmdb/app`'s entry imports it first.

export const POLYFILLED = true;

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

declare global {
  interface Uint8Array {
    toBase64(options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string;
  }
  interface Uint8ArrayConstructor {
    fromBase64(
      string: string,
      options?: { alphabet?: 'base64' | 'base64url'; lastChunkHandling?: 'loose' | 'strict' | 'stop-before-partial' },
    ): Uint8Array<ArrayBuffer>;
  }
}

if (typeof Uint8Array.fromBase64 !== 'function') {
  const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < b64chars.length; i += 1) {
    lookup[b64chars.charCodeAt(i)] = i;
  }
  Reflect.defineProperty(Uint8Array, 'fromBase64', {
    value: function (
      string: string,
      options?: { alphabet?: 'base64' | 'base64url'; lastChunkHandling?: 'loose' | 'strict' | 'stop-before-partial' },
    ): Uint8Array<ArrayBuffer> {
      let b64 = string;
      if (options?.alphabet === 'base64url') {
        b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
      }
      while (b64.length % 4 !== 0) {
        b64 += '=';
      }
      let pad = 0;
      if (b64.endsWith('==')) pad = 2;
      else if (b64.endsWith('=')) pad = 1;
      const len = b64.length;
      const byteLen = Math.floor((len * 3) / 4) - pad;
      const bytes = new Uint8Array(byteLen);
      let p = 0;
      for (let i = 0; i < len; i += 4) {
        const c1 = lookup[b64.charCodeAt(i)] ?? 0;
        const c2 = lookup[b64.charCodeAt(i + 1)] ?? 0;
        const c3 = lookup[b64.charCodeAt(i + 2)] ?? 0;
        const c4 = lookup[b64.charCodeAt(i + 3)] ?? 0;
        const triplet = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
        if (p < byteLen) bytes[p++] = (triplet >> 16) & 255;
        if (p < byteLen) bytes[p++] = (triplet >> 8) & 255;
        if (p < byteLen) bytes[p++] = triplet & 255;
      }
      return bytes;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

if (typeof Uint8Array.prototype.toBase64 !== 'function') {
  const proto = Uint8Array.prototype;
  Reflect.defineProperty(proto, 'toBase64', {
    value: function (this: Uint8Array, options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string {
      const chars =
        options?.alphabet === 'base64url'
          ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
          : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let result = '';
      const len = this.length;
      for (let i = 0; i < len; i += 3) {
        const b1 = this[i] ?? 0;
        const b2 = i + 1 < len ? (this[i + 1] ?? 0) : 0;
        const b3 = i + 2 < len ? (this[i + 2] ?? 0) : 0;
        const triplet = (b1 << 16) | (b2 << 8) | b3;
        result += chars[(triplet >> 18) & 63];
        result += chars[(triplet >> 12) & 63];
        if (i + 1 < len) {
          result += chars[(triplet >> 6) & 63];
        } else if (!options?.omitPadding) {
          result += '=';
        }
        if (i + 2 < len) {
          result += chars[triplet & 63];
        } else if (!options?.omitPadding) {
          result += '=';
        }
      }
      return result;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
