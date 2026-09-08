import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

function bytesToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i] ?? 0;
    const b2 = i + 1 < len ? (bytes[i + 1] ?? 0) : 0;
    const b3 = i + 2 < len ? (bytes[i + 2] ?? 0) : 0;
    const tri = (b1 << 16) | (b2 << 8) | b3;
    base64 += chars[(tri >> 18) & 63] + chars[(tri >> 12) & 63];
    base64 += i + 1 < len ? chars[(tri >> 6) & 63] : '=';
    base64 += i + 2 < len ? chars[tri & 63] : '=';
  }
  return base64;
}

export async function startRegistry(packages) {
  const requests = [];
  const tarballs = new Map();
  for (const entry of packages) {
    const bytes = await readFile(entry.tarball);
    const sha512 = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', bytes));
    const b64 = typeof sha512.toBase64 === 'function' ? sha512.toBase64() : bytesToBase64(sha512);
    const sha1 = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', bytes));
    const hex =
      typeof sha1.toHex === 'function' ? sha1.toHex() : Array.from(sha1, b => b.toString(16).padStart(2, '0')).join('');
    tarballs.set(entry.manifest.name, {
      ...entry,
      bytes,
      integrity: `sha512-${b64}`,
      shasum: hex,
    });
  }
  let origin;
  const server = createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, origin).pathname.slice(1));
    requests.push(requested);
    const isTarball = requested.endsWith('/artifact.tgz');
    const name = isTarball ? requested.slice(0, -'/artifact.tgz'.length) : requested;
    const entry = tarballs.get(name);
    if (entry === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: `No issue tarball for ${name}` }));
      return;
    }
    if (isTarball) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(entry.bytes);
      return;
    }
    const manifest = {
      ...entry.manifest,
      dist: {
        tarball: `${origin}/${encodeURIComponent(name)}/artifact.tgz`,
        integrity: entry.integrity,
        shasum: entry.shasum,
      },
    };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        name,
        'dist-tags': { latest: manifest.version, alpha: manifest.version },
        versions: { [manifest.version]: manifest },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
