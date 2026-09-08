/* oxlint-disable */
// Polyfill Uint8Array.prototype.toBase64 and Uint8Array.fromBase64 for Node < 24 environments
if (typeof (Uint8Array.prototype as unknown as Record<string, unknown>).toBase64 !== 'function') {
  (Uint8Array.prototype as unknown as Record<string, unknown>).toBase64 = function (options?: {
    alphabet?: string;
    omitPadding?: boolean;
  }) {
    const buf = Buffer.from(this.buffer, this.byteOffset, this.byteLength);
    let str = options?.alphabet === 'base64url' ? buf.toString('base64url') : buf.toString('base64');
    if (options?.omitPadding) {
      str = str.replace(/=+$/, '');
    }
    return str;
  };
}

if (typeof (Uint8Array as unknown as Record<string, unknown>).fromBase64 !== 'function') {
  (Uint8Array as unknown as Record<string, unknown>).fromBase64 = function (
    string: string,
    options?: { alphabet?: string },
  ) {
    const encoding = options?.alphabet === 'base64url' ? 'base64url' : 'base64';
    return new Uint8Array(Buffer.from(string, encoding));
  };
}
