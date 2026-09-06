if (typeof (Uint8Array.prototype as any).toBase64 !== 'function') {
  (Uint8Array.prototype as any).toBase64 = function (options?: { alphabet?: string; omitPadding?: boolean }) {
    let buf = Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64');
    if (options?.alphabet === 'base64url') {
      buf = buf.replace(/\+/g, '-').replace(/\//g, '_');
    }
    if (options?.omitPadding) {
      buf = buf.replace(/=/g, '');
    }
    return buf;
  };
}

if (typeof (Uint8Array as any).fromBase64 !== 'function') {
  (Uint8Array as any).fromBase64 = function (string: string, options?: { alphabet?: string }) {
    let base64 = string;
    if (options?.alphabet === 'base64url') {
      base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
    }
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const buf = Buffer.from(base64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
}
