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

interface Uint8ArrayWithBase64 {
  toBase64?: (options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }) => string;
}

interface Uint8ArrayCtorWithBase64 {
  fromBase64?: (string: string, options?: { alphabet?: 'base64' | 'base64url' }) => Uint8Array;
}

const uint8ArrayProto: Uint8ArrayWithBase64 = Uint8Array.prototype;
if (typeof uint8ArrayProto.toBase64 !== 'function') {
  uint8ArrayProto.toBase64 = function (
    this: Uint8Array,
    options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean },
  ): string {
    const alphabet = options?.alphabet === 'base64url' ? 'base64url' : 'base64';
    if (typeof Buffer !== 'undefined') {
      let str = Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString(alphabet);
      if (options?.omitPadding) {
        str = str.replace(/=+$/, '');
      }
      return str;
    }
    const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const omitPadding = options?.omitPadding ?? false;
    const chars = alphabet === 'base64url' ? BASE64URL_CHARS : BASE64_CHARS;
    let result = '';
    const len = this.length;
    let i = 0;
    for (; i < len - 2; i += 3) {
      const b0 = this[i] ?? 0;
      const b1 = this[i + 1] ?? 0;
      const b2 = this[i + 2] ?? 0;
      result += chars.charAt(b0 >> 2);
      result += chars.charAt(((b0 & 3) << 4) | (b1 >> 4));
      result += chars.charAt(((b1 & 15) << 2) | (b2 >> 6));
      result += chars.charAt(b2 & 63);
    }
    if (i < len) {
      const b0 = this[i] ?? 0;
      result += chars.charAt(b0 >> 2);
      if (i === len - 1) {
        result += chars.charAt((b0 & 3) << 4);
        if (!omitPadding && alphabet !== 'base64url') {
          result += '==';
        }
      } else {
        const b1 = this[i + 1] ?? 0;
        result += chars.charAt(((b0 & 3) << 4) | (b1 >> 4));
        result += chars.charAt((b1 & 15) << 2);
        if (!omitPadding && alphabet !== 'base64url') {
          result += '=';
        }
      }
    }
    return result;
  };
}

const uint8ArrayCtor: Uint8ArrayCtorWithBase64 = Uint8Array;
if (typeof uint8ArrayCtor.fromBase64 !== 'function') {
  uint8ArrayCtor.fromBase64 = function (string: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array {
    const alphabet = options?.alphabet === 'base64url' ? 'base64url' : 'base64';
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(string, alphabet);
      return new Uint8Array(buf);
    }
    const base64 = alphabet === 'base64url' ? string.replace(/-/g, '+').replace(/_/g, '/') : string;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };
}
