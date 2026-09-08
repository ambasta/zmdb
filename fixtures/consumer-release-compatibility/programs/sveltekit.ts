import assert from 'node:assert/strict';

import { createSvelteKitServerFetch } from '@zmdb/sveltekit/server';

let headers: Headers | undefined;
const selected = createSvelteKitServerFetch(
  {
    request: new Request('http://wiremock.invalid', { headers: { authorization: 'Bearer private' } }),
    cookies: {
      get: () => 'session-π',
      getAll: () => [],
      set() {},
      delete() {},
      serialize: (name, value) => `${name}=${value}`,
    },
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response('reply-π');
    },
  },
  { headers: ['authorization'], cookies: ['session'] },
);
assert.equal(await (await selected('http://wiremock.invalid')).text(), 'reply-π');
assert.equal(headers?.get('authorization'), 'Bearer private');
assert.equal(headers?.get('cookie'), 'session=session-%CF%80');
