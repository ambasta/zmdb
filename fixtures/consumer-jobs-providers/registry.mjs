import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

function toHex(uint8) {
  if (typeof uint8.toHex === 'function') return uint8.toHex();
  // oxlint-disable-next-line no-restricted-globals, no-restricted-properties
  return Buffer.from(uint8).toString('hex');
}

function toBase64(uint8) {
  if (typeof uint8.toBase64 === 'function') return uint8.toBase64();
  // oxlint-disable-next-line no-restricted-globals, no-restricted-properties
  return Buffer.from(uint8).toString('base64');
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
