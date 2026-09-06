import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';

import { createSvelteKitClientLoad, createSvelteKitNavigationScope } from '@zmdb/sveltekit/client';

import { handler } from './build/handler.js';

function transportClient(options) {
  if (options.transport === undefined) throw new Error('packed client factory received no transport');
  return Object.freeze({
    async getWidget(input, callOptions) {
      const base = String(options.baseUrl).replace(/\/$/, '');
      const response = await options.transport({
        method: 'GET',
        url: `${base}/widgets/${encodeURIComponent(input.id)}`,
        headers: { accept: 'application/json' },
        signal: callOptions.signal,
      });
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      }).json();
    },
  });
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const server = createServer(handler);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('packed server has no TCP address');
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const page = (id, tenant, session) =>
    fetch(`${baseUrl}/?id=${encodeURIComponent(id)}`, {
      headers: {
        cookie: `session=${session}; ignored=hidden`,
        'x-tenant': tenant,
      },
    }).then(async response => ({ status: response.status, body: await response.text() }));

  const [first, second] = await Promise.all([
    page('first', 'tenant-first', 'session-first'),
    page('second', 'tenant-second', 'session-second'),
  ]);
  assert.equal(first.status, 200);
  assert.match(first.body, /first:tenant-first:session=session-first/);
  assert.doesNotMatch(first.body, /tenant-second|ignored=hidden/);
  assert.equal(second.status, 200);
  assert.match(second.body, /second:tenant-second:session=session-second/);
  assert.doesNotMatch(second.body, /tenant-first|ignored=hidden/);

  const redirected = await fetch(`${baseUrl}/?mode=redirect`, { redirect: 'manual' });
  assert.equal(redirected.status, 307);
  assert.equal(redirected.headers.get('location'), '/redirected');

  const failed = await fetch(`${baseUrl}/?mode=error`);
  assert.equal(failed.status, 418);

  const dependencies = [];
  const navigation = createSvelteKitNavigationScope();
  const browserLoad = createSvelteKitClientLoad({
    key: 'widget:packed-browser',
    navigation,
    createClient: transportClient,
    clientOptions: { baseUrl: '/api' },
    load: (client, _event, signal) => client.getWidget({ id: 'browser' }, { signal }),
  });
  const browserResult = await browserLoad({
    depends: key => dependencies.push(key),
    fetch: (input, init) => fetch(new URL(requestUrl(input), baseUrl), init),
  });
  assert.deepEqual(browserResult, {
    id: 'browser',
    name: 'no-tenant:no-cookie',
  });
  assert.deepEqual(dependencies, ['widget:packed-browser']);

  const completion = Promise.withResolvers();
  const selectedSignal = navigation.track({ complete: completion.promise });
  const started = Promise.withResolvers();
  const abandonedLoad = createSvelteKitClientLoad({
    key: 'widget:packed-abandoned',
    navigation,
    createClient: transportClient,
    clientOptions: { baseUrl: '/api' },
    load: (client, _event, signal) => client.getWidget({ id: 'abandoned' }, { signal }),
  });
  const operation = abandonedLoad({
    depends: () => undefined,
    fetch: async (_input, init) => {
      started.resolve();
      if (init?.signal?.aborted) throw init.signal.reason;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    },
  });
  await started.promise;
  const reason = Object.freeze({ kind: 'packed-navigation-aborted' });
  completion.reject(reason);
  await assert.rejects(operation, thrown => Object.is(thrown, reason));
  assert.equal(selectedSignal.aborted, true);
  assert.equal(selectedSignal.reason, reason);

  process.stdout.write(
    `${JSON.stringify({
      browser: browserResult.name,
      cancellation: selectedSignal.aborted,
      redirects: redirected.status,
      ssr: [first.status, second.status],
      statusError: failed.status,
    })}\n`,
  );
} finally {
  await new Promise((resolve, reject) => {
    server.close(error => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
