import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

async function digest(algorithm, bytes, encoding = 'hex') {
  const hashed = new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, bytes));
  if (typeof hashed.toBase64 === 'function' && encoding === 'base64') return hashed.toBase64();
  if (typeof hashed.toHex === 'function' && encoding === 'hex') return hashed.toHex();
  return encoding === 'base64'
    ? // oxlint-disable-next-line eslint/no-restricted-globals
      btoa(Array.from(hashed, b => String.fromCharCode(b)).join(''))
    : Array.from(hashed, b => b.toString(16).padStart(2, '0')).join('');
}

export async function startRegistry(packages) {
  const requests = [];
  const tarballs = new Map();
  for (const entry of packages) {
    const bytes = await readFile(entry.tarball);
    tarballs.set(entry.manifest.name, {
      ...entry,
      bytes,
      integrity: `sha512-${await digest('SHA-512', bytes, 'base64')}`,
      shasum: await digest('SHA-1', bytes, 'hex'),
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
