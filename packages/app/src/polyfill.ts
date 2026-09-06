// oxlint-disable no-extend-native, no-restricted-globals, no-restricted-properties
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

// boundary: Uint8Array polyfills for toBase64 and fromBase64 check Reflect property existence dynamically.
if (typeof Reflect.get(Uint8Array.prototype, 'toBase64') !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value: function (this: Uint8Array, options?: { alphabet?: string; omitPadding?: boolean }): string {
      let b64 = Buffer.from(this).toString('base64url');
      if (options?.omitPadding) {
        b64 = b64.replace(/=+$/, '');
      }
      return b64;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof Reflect.get(Uint8Array, 'fromBase64') !== 'function') {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: function (string: string): Uint8Array {
      return new Uint8Array(Buffer.from(string, 'base64url'));
    },
    writable: true,
    configurable: true,
  });
}
