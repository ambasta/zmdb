import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const ROOT = process.cwd();
const SERVER_CREDENTIAL = 'zmdb-next-server-credential-697';

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function javascriptUnder(directory) {
  return filesUnder(directory).filter(path => path.endsWith('.js'));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('could not allocate a fixture port');
  await new Promise((resolve, reject) => {
    server.close(error => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

function attribute(html, name) {
  const match = new RegExp(`${name}="([^"]*)"`).exec(html);
  if (match?.[1] === undefined) throw new Error(`rendered page omitted ${name}`);
  return match[1];
}

function assertPage(html, expected) {
  if (!html.includes('client-ready')) throw new Error('client component did not render through @zmdb/next/client');
  if (html.includes(SERVER_CREDENTIAL)) throw new Error('server credential entered rendered HTML');
  if (attribute(html, 'data-authorization') !== expected.authorization) throw new Error('authorization drifted');
  if (attribute(html, 'data-tenant') !== expected.tenant) throw new Error('tenant drifted');
  if (attribute(html, 'data-session') !== expected.session) throw new Error('session drifted');
  if (attribute(html, 'data-ignored-header') !== 'false') throw new Error('an unselected header was forwarded');
  if (attribute(html, 'data-ignored-cookie') !== 'false') throw new Error('an unselected cookie was forwarded');
  if (attribute(html, 'data-duplicate') !== 'true') throw new Error('server-component duplicate was not memoized');
  return attribute(html, 'data-request-id');
}

async function response(url, identity) {
  const result = await fetch(url, {
    headers: {
      authorization: identity.authorization,
      cookie: `session=${identity.session}; ignored=do-not-forward`,
      'x-ignored': 'do-not-forward',
      'x-tenant-id': identity.tenant,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!result.ok) throw new Error(`${url} returned ${String(result.status)}: ${await result.text()}`);
  return result;
}

async function waitForPage(url, identity, processState) {
  const deadline = Date.now() + 30_000;
  let failure;
  while (Date.now() < deadline) {
    if (processState.exited) {
      throw new Error(`Next exited before readiness:\n${processState.stdout}\n${processState.stderr}`);
    }
    try {
      return await response(url, identity);
    } catch (error) {
      failure = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Next did not become ready: ${String(failure)}\n${processState.stdout}\n${processState.stderr}`);
}

const port = await freePort();
const origin = `http://127.0.0.1:${String(port)}`;
const processState = { exited: false, stdout: '', stderr: '' };
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      ZMDB_NEXT_FIXTURE_ORIGIN: origin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', chunk => {
  processState.stdout += String(chunk);
});
child.stderr.on('data', chunk => {
  processState.stderr += String(chunk);
});
const exited = new Promise(resolve => {
  child.once('exit', (code, signal) => {
    processState.exited = true;
    resolve({ code, signal });
  });
});

try {
  const firstIdentity = {
    authorization: 'Bearer first',
    tenant: 'tenant-first',
    session: 'session-first',
  };
  const secondIdentity = {
    authorization: 'Bearer second',
    tenant: 'tenant-second',
    session: 'session-second',
  };
  const firstHtml = await (await waitForPage(origin, firstIdentity, processState)).text();
  const secondHtml = await (await response(origin, secondIdentity)).text();
  const firstRequestId = assertPage(firstHtml, firstIdentity);
  const secondRequestId = assertPage(secondHtml, secondIdentity);
  if (firstRequestId === secondRequestId) throw new Error('two SSR requests shared a memoized upstream result');

  const routeIdentity = {
    authorization: 'Bearer route',
    tenant: 'tenant-route',
    session: 'session-route',
  };
  const route = await (await response(`${origin}/api/scope`, routeIdentity)).json();
  if (
    route.authorization !== routeIdentity.authorization ||
    route.tenant !== routeIdentity.tenant ||
    route.session !== routeIdentity.session ||
    route.ignoredHeader !== false ||
    route.ignoredCookie !== false ||
    route.duplicate !== true
  ) {
    throw new Error(`route-handler request scope failed: ${JSON.stringify(route)}`);
  }

  const browserFiles = javascriptUnder(join(ROOT, '.next', 'static', 'chunks'));
  const browserSource = browserFiles.map(path => readFileSync(path, 'utf8')).join('\n');
  if (!browserSource.includes('client-ready')) throw new Error('browser chunks omitted the client component');
  if (browserSource.includes(SERVER_CREDENTIAL)) throw new Error('server credential entered a browser chunk');
  if (browserSource.includes('@zmdb/next/server')) throw new Error('server package specifier entered a browser chunk');
  if (browserSource.includes('createNextServerClient')) throw new Error('server factory entered a browser chunk');

  const serverFiles = javascriptUnder(join(ROOT, '.next', 'server'));
  const serverCopies = serverFiles.filter(path => readFileSync(path, 'utf8').includes(SERVER_CREDENTIAL));
  if (serverCopies.length === 0) throw new Error('server credential canary was absent from server output');

  process.stdout.write(
    JSON.stringify({
      pages: 2,
      routeHandler: true,
      requestLocalMemoization: true,
      browserChunks: browserFiles.length,
      serverCredentialCopies: serverCopies.length,
    }),
  );
} finally {
  if (!processState.exited) child.kill('SIGTERM');
  const stopped = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(undefined), 10_000))]);
  if (stopped === undefined && !processState.exited) {
    child.kill('SIGKILL');
    await exited;
  }
}
