import { createClientRuntime, createFetchTransport } from '@zmdb/client';

let observed;
const fetch = async (input, init) => {
  observed = { input, init };
  return new Response('{"id":"node-widget"}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const operation = {
  abi: 1,
  operationId: 'get_node_widget',
  method: 'GET',
  security: [],
  schemes: {},
  version: { kind: 'none' },
  prepare() {
    return {
      path: '/widgets/node%2Fone',
      query: [{ name: 'include', value: 'owner & roles' }],
      headers: { accept: 'application/json' },
      cookies: [],
    };
  },
  async read(response) {
    return response.body.json('application/json', value => {
      if (typeof value === 'object' && value !== null && typeof Reflect.get(value, 'id') === 'string') {
        return { ok: true, value: { id: Reflect.get(value, 'id') } };
      }
      return { ok: false, issues: [{ path: '$.id', message: 'expected string' }] };
    });
  },
};

const result = await createClientRuntime({
  baseUrl: 'https://api.example.test/v1',
  transport: createFetchTransport(fetch),
}).call(operation, {});

if (result.id !== 'node-widget') throw new Error('Node consumer did not decode the response');
if (observed?.input !== 'https://api.example.test/v1/widgets/node%2Fone?include=owner%20%26%20roles') {
  throw new Error(`Node consumer received unexpected URL ${String(observed?.input)}`);
}
if (observed?.init?.redirect !== 'manual') throw new Error('Node consumer did not use manual redirects');

process.stdout.write('node-packed-client-ok\n');
