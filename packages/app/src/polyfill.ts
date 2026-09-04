// Zero-dependency Symbol.metadata and Uint8Array base64 baseline.
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

// boundary: polyfill Uint8Array.prototype.toBase64 and Uint8Array.fromBase64 for Node < 23
if (!('toBase64' in Uint8Array.prototype)) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const LOOKUP = new Uint8Array(256);
  for (let i = 0; i < B64.length; i += 1) {
    const code = B64.charCodeAt(i);
    if (code !== undefined) LOOKUP[code] = i;
  }

  // boundary: sound property assignment on prototype
  Reflect.defineProperty(Uint8Array.prototype, 'toBase64', {
    // boundary: sound polyfill method
    value: function toBase64(this: Uint8Array, _options?: { alphabet?: string; omitPadding?: boolean }): string {
      let result = '';
      const len = this.length;
      for (let i = 0; i < len; i += 3) {
        const b0 = this[i] ?? 0;
        const b1 = i + 1 < len ? (this[i + 1] ?? 0) : 0;
        const b2 = i + 2 < len ? (this[i + 2] ?? 0) : 0;
        result += B64[b0 >> 2];
        result += B64[((b0 & 3) << 4) | (b1 >> 4)];
        if (i + 1 < len) {
          result += B64[((b1 & 15) << 2) | (b2 >> 6)];
        }
        if (i + 2 < len) {
          result += B64[b2 & 63];
        }
      }
      return result;
    },
    writable: true,
    configurable: true,
  });

  // boundary: sound property assignment on constructor
  Reflect.defineProperty(Uint8Array, 'fromBase64', {
    // boundary: sound polyfill method
    value: function fromBase64(string: string, _options?: { alphabet?: string }): Uint8Array {
      const len = string.length;
      const outLen = Math.floor((len * 3) / 4);
      const bytes = new Uint8Array(outLen);
      let byteIdx = 0;
      for (let i = 0; i < len; i += 4) {
        const c0 = LOOKUP[string.charCodeAt(i)] ?? 0;
        const c1 = LOOKUP[string.charCodeAt(i + 1)] ?? 0;
        const c2 = i + 2 < len ? (LOOKUP[string.charCodeAt(i + 2)] ?? 64) : 64;
        const c3 = i + 3 < len ? (LOOKUP[string.charCodeAt(i + 3)] ?? 64) : 64;
        bytes[byteIdx] = (c0 << 2) | (c1 >> 4);
        byteIdx += 1;
        if (i + 2 < len && c2 !== 64) {
          bytes[byteIdx] = ((c1 & 15) << 4) | (c2 >> 2);
          byteIdx += 1;
        }
        if (i + 3 < len && c3 !== 64) {
          bytes[byteIdx] = ((c2 & 3) << 6) | c3;
          byteIdx += 1;
        }
      }
      return bytes.subarray(0, byteIdx);
    },
    writable: true,
    configurable: true,
  });
}
