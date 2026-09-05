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

interface GlobalWithBtoaAtob {
  btoa?: (data: string) => string;
  atob?: (data: string) => string;
}

if (!('toBase64' in Uint8Array.prototype)) {
  const globalCarrier: GlobalWithBtoaAtob = globalThis;
  Reflect.defineProperty(Uint8Array.prototype, 'toBase64', {
    value: function (options?: { alphabet?: string; omitPadding?: boolean }) {
      let binary = '';
      const len = this.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(this[i]);
      }
      let base64 = typeof globalCarrier.btoa === 'function' ? globalCarrier.btoa(binary) : '';
      if (options?.alphabet === 'base64url') {
        base64 = base64.replace(/\+/g, '-').replace(/\//g, '_');
      }
      if (options?.omitPadding) {
        base64 = base64.replace(/=+$/, '');
      }
      return base64;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

if (!('fromBase64' in Uint8Array)) {
  const globalCarrier: GlobalWithBtoaAtob = globalThis;
  Reflect.defineProperty(Uint8Array, 'fromBase64', {
    value: function (base64Text: string, options?: { alphabet?: string }) {
      let normalised = base64Text;
      if (options?.alphabet === 'base64url') {
        normalised = normalised.replace(/-/g, '+').replace(/_/g, '/');
      }
      while (normalised.length % 4 !== 0) {
        normalised += '=';
      }
      const binary = typeof globalCarrier.atob === 'function' ? globalCarrier.atob(normalised) : '';
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
