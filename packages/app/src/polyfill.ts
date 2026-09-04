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

if (typeof (Uint8Array.prototype as { toBase64?: unknown }).toBase64 !== 'function') {
  const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const b64urlchars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // oxlint-disable-next-line no-extend-native
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value: function (this: Uint8Array, options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string {
      const alphabet = options?.alphabet === 'base64url' ? b64urlchars : b64chars;
      const omitPadding = options?.omitPadding ?? false;
      let result = '';
      const len = this.length;
      for (let i = 0; i < len; i += 3) {
        const b1 = this[i]!;
        const b2 = i + 1 < len ? this[i + 1]! : 0;
        const b3 = i + 2 < len ? this[i + 2]! : 0;
        const c1 = b1 >> 2;
        const c2 = ((b1 & 3) << 4) | (b2 >> 4);
        const c3 = ((b2 & 15) << 2) | (b3 >> 6);
        const c4 = b3 & 63;
        result += alphabet[c1]! + alphabet[c2]!;
        if (i + 1 < len) result += alphabet[c3]!;
        else if (!omitPadding) result += '=';
        if (i + 2 < len) result += alphabet[c4]!;
        else if (!omitPadding) result += '=';
      }
      return result;
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: function (string: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array {
      const alphabet = options?.alphabet === 'base64url' ? b64urlchars : b64chars;
      const map = new Map<string, number>();
      for (let i = 0; i < alphabet.length; i += 1) map.set(alphabet[i]!, i);
      const clean = string.replace(/=/g, '');
      const bytes: number[] = [];
      let i = 0;
      while (i < clean.length) {
        const c1 = map.get(clean[i++]!);
        const c2 = i < clean.length ? map.get(clean[i++]!) : 0;
        const c3 = i < clean.length ? map.get(clean[i++]!) : undefined;
        const c4 = i < clean.length ? map.get(clean[i++]!) : undefined;
        if (c1 === undefined || c2 === undefined) break;
        bytes.push((c1 << 2) | (c2 >> 4));
        if (c3 !== undefined) {
          bytes.push(((c2 & 15) << 4) | (c3 >> 2));
          if (c4 !== undefined) {
            bytes.push(((c3 & 3) << 6) | c4);
          }
        }
      }
      return new Uint8Array(bytes);
    },
    writable: true,
    configurable: true,
  });
}
