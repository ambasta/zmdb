import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a loopback port'));
        return;
      }
      server.close(error => {
        if (error === undefined) resolve(address.port);
        else reject(error);
      });
    });
  });
}

function waitForServer(child, origin) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for packed Nuxt server: ${stderr}`));
    }, 30_000);
    const poll = async () => {
      try {
        const response = await fetch(`${origin}/api/observations`);
        if (response.ok) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      } catch {}
      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`packed Nuxt server exited before listening: ${stderr}`));
        return;
      }
      setTimeout(poll, 50);
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    void poll();
  });
}

function request(origin, id, credential, session) {
  return fetch(`${origin}/?id=${encodeURIComponent(id)}`, {
    headers: {
      authorization: `Bearer ${credential}`,
      cookie: `session=${session}; hidden=${credential}-hidden-cookie`,
      'x-hidden': `${credential}-hidden-header`,
    },
  }).then(async response => ({
    body: await response.text(),
    status: response.status,
  }));
}

const port = await availablePort();
const origin = `http://127.0.0.1:${String(port)}`;
const child = spawn(process.execPath, ['.output/server/index.mjs'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(child, origin);
  const [first, second] = await Promise.all([
    request(origin, 'first', 'first', 'first-session'),
    request(origin, 'second', 'second', 'second-session'),
  ]);
  if (first.status !== 200 || second.status !== 200) {
    throw new Error(`packed Nuxt SSR returned ${String(first.status)}/${String(second.status)}`);
  }
  const firstResult = 'Bearer first|first-session|none|none';
  const secondResult = 'Bearer second|second-session|none|none';
  if (!first.body.includes(firstResult) || first.body.includes(secondResult)) {
    throw new Error('first packed Nuxt SSR response did not retain its request-local credentials');
  }
  if (!second.body.includes(secondResult) || second.body.includes(firstResult)) {
    throw new Error('second packed Nuxt SSR response did not retain its request-local credentials');
  }
  if (!first.body.includes('__NUXT_DATA__') || !second.body.includes('__NUXT_DATA__')) {
    throw new Error('packed Nuxt SSR response omitted the native hydration payload');
  }

  const observationsResponse = await fetch(`${origin}/api/observations`);
  const observations = await observationsResponse.json();
  const expected = [
    {
      authorization: 'Bearer first',
      hiddenCookie: null,
      hiddenHeader: null,
      id: 'first',
      session: 'first-session',
    },
    {
      authorization: 'Bearer second',
      hiddenCookie: null,
      hiddenHeader: null,
      id: 'second',
      session: 'second-session',
    },
  ];
  observations.sort((left, right) => left.id.localeCompare(right.id));
  if (JSON.stringify(observations) !== JSON.stringify(expected)) {
    throw new Error(`packed Nuxt request observations differ: ${JSON.stringify(observations)}`);
  }
  process.stdout.write(
    JSON.stringify({
      observations: observations.length,
      payload: true,
      requests: ['first', 'second'],
    }),
  );
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
}
