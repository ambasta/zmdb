if (typeof Uint8Array.prototype.toBase64 !== 'function') {
  const buf = globalThis.Buffer;
  if (buf) {
    // oxlint-disable-next-line no-extend-native
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value(this: Uint8Array) {
        return buf.from(this.buffer, this.byteOffset, this.byteLength).toString('base64url');
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value(str: string) {
        return new Uint8Array(buf.from(str, 'base64url'));
      },
      writable: true,
      configurable: true,
    });
  }
}
