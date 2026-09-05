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

const nodeBuffer = globalThis.Buffer;

if (!('toBase64' in Uint8Array.prototype) && nodeBuffer) {
  Reflect.defineProperty(Uint8Array.prototype, 'toBase64', {
    value(this: Uint8Array, options?: { alphabet?: string; omitPadding?: boolean }) {
      let result = nodeBuffer
        .from(this.buffer, this.byteOffset, this.byteLength)
        .toString(options?.alphabet === 'base64url' ? 'base64url' : 'base64');
      if (options?.omitPadding) {
        result = result.replace(/=+$/, '');
      }
      return result;
    },
    writable: true,
    configurable: true,
  });
}

if (!('fromBase64' in Uint8Array) && nodeBuffer) {
  Reflect.defineProperty(Uint8Array, 'fromBase64', {
    value(string: string, options?: { alphabet?: string }) {
      const buf = nodeBuffer.from(string, options?.alphabet === 'base64url' ? 'base64url' : 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    writable: true,
    configurable: true,
  });
}
