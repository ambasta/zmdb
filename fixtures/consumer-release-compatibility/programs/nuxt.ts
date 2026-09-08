import assert from 'node:assert/strict';

import { createNuxtServerTransport } from '@zmdb/nuxt/server';

let headers: Headers | undefined;
const transport = createNuxtServerTransport(
  async (_input, init) => {
    headers = new Headers(init?.headers);
    return new Response('wire-π');
  },
  new Headers({ authorization: 'Bearer private', cookie: 'session=abc; hidden=secret' }),
  { forwardHeaders: ['authorization'], forwardCookies: ['session'] },
);
const result = await transport({ url: 'http://wiremock.invalid', method: 'GET', headers: {} });
assert.equal(result.status, 200);
assert.equal(headers?.get('authorization'), 'Bearer private');
assert.equal(headers?.get('cookie'), 'session=abc');
assert.equal(await new Response(result.body).text(), 'wire-π');
