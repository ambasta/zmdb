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

if (!('toBase64' in Uint8Array.prototype)) {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value: function (options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string {
      const alphabet = options?.alphabet ?? 'base64';
      const omitPadding = options?.omitPadding ?? false;
      let str = Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString(
        alphabet === 'base64url' ? 'base64url' : 'base64',
      );
      if (omitPadding && str.endsWith('=')) {
        str = str.replace(/=+$/, '');
      }
      return str;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

if (!('fromBase64' in Uint8Array)) {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: function (string: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array {
      const alphabet = options?.alphabet ?? 'base64';
      let base64Str = string;
      if (alphabet === 'base64url') {
        base64Str = string.replace(/-/g, '+').replace(/_/g, '/');
        while (base64Str.length % 4 !== 0) {
          base64Str += '=';
        }
      }
      const buf = Buffer.from(base64Str, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
