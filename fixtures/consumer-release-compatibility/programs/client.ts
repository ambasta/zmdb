import assert from 'node:assert/strict';

import { createFetchTransport, substituteClientPath } from '@zmdb/client';

let url: string | undefined;
const transport = createFetchTransport(async (input, init) => {
  url = String(input);
  assert.equal(init?.method, 'POST');
  assert.equal(new Headers(init?.headers).get('x-release'), 'yes');
  return new Response('reply-π', { status: 201 });
});
const path = substituteClientPath('/items/:id', 'id', 'π/1');
const response = await transport({
  url: `http://wiremock.invalid${path}`,
  method: 'POST',
  headers: { 'x-release': 'yes' },
});
assert.equal(url, 'http://wiremock.invalid/items/%CF%80%2F1');
assert.equal(response.status, 201);
assert.equal(await new Response(response.body).text(), 'reply-π');
