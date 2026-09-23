import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const byteHex = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toHex(bytes) {
  if (typeof bytes.toHex === 'function') return bytes.toHex();
  return Array.from(bytes, b => byteHex[b]).join('');
}

function toBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    result += b64Chars[b1 >> 2];
    result += b64Chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? b64Chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < len ? b64Chars[b3 & 63] : '=';
  }
  return result;
}

export async function startRegistry(packages) {
  const requests = [];
  const tarballs = new Map();
  for (const entry of packages) {
    const bytes = await readFile(entry.tarball);
    tarballs.set(entry.manifest.name, {
      ...entry,
      bytes,
      integrity: `sha512-${toBase64(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', bytes)))}`,
      shasum: toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', bytes))),
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
