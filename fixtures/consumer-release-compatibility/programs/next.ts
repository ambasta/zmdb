import assert from 'node:assert/strict';

import { createNextServerClient } from '@zmdb/next/server';

const request = { headers: new Headers({ authorization: 'Bearer private' }), cookies: { get: () => undefined } };
const selected = await createNextServerClient({
  request,
  baseUrl: 'http://wiremock.invalid',
  createClient: options => ({ baseUrl: options.baseUrl }),
  fetch: globalThis.fetch,
});
let calls = 0;
const load = selected.memoize(
  (client, key: string) => {
    calls++;
    return Promise.resolve(`${client.baseUrl}:${key}`);
  },
  key => key,
);
const first = load('π');
assert.equal(load('π'), first);
assert.equal(await first, 'http://wiremock.invalid:π');
assert.equal(calls, 1);
