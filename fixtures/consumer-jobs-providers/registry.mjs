import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

function toHex(bytes) {
  if (typeof bytes.toHex === 'function') return bytes.toHex();
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triplet = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      chars[(triplet >> 18) & 63] + chars[(triplet >> 12) & 63] + chars[(triplet >> 6) & 63] + chars[triplet & 63];
  }
  if (i < bytes.length) {
    const byte1 = bytes[i];
    const byte2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const triplet = (byte1 << 16) | (byte2 << 8);
    result += chars[(triplet >> 18) & 63] + chars[(triplet >> 12) & 63];
    result += i + 1 < bytes.length ? chars[(triplet >> 6) & 63] : '=';
    result += '=';
  }
  return result;
}

export async function startRegistry(packages) {
  const requests = [];
  const tarballs = new Map();
  for (const entry of packages) {
    const bytes = await readFile(entry.tarball);
    const sha512Arr = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', bytes));
    const sha512Base64 = toBase64(sha512Arr);
    const sha1Arr = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', bytes));
    const sha1Hex = toHex(sha1Arr);
    tarballs.set(entry.manifest.name, {
      ...entry,
      bytes,
      integrity: `sha512-${sha512Base64}`,
      shasum: sha1Hex,
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
