import { createClientRuntime } from '@zmdb/client';
import { createFakeClientTransport } from '@zmdb/client/testing';

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
Reflect.deleteProperty(globalThis, 'fetch');

try {
  const fake = createFakeClientTransport();
  const operation = {
    abi: 1,
    operationId: 'get_browser_widget',
    method: 'GET',
    security: [],
    schemes: {},
    version: { kind: 'none' },
    prepare() {
      return {
        path: '/widgets/browser%2Fone',
        query: [{ name: 'tag', value: 'one two' }],
        headers: { accept: 'text/plain' },
        cookies: [],
      };
    },
    async read(response) {
      return response.body.text('text/plain');
    },
  };
  const pending = createClientRuntime({ baseUrl: '/api/', transport: fake.transport }).call(operation, {});
  const held = await fake.nextRequest();
  if (held.request.url !== '/api/widgets/browser%2Fone?tag=one%20two') {
    throw new Error(`Browser consumer received unexpected URL ${held.request.url}`);
  }
  held.respond({
    status: 200,
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('browser-widget'));
        controller.close();
      },
    }),
  });
  if ((await pending) !== 'browser-widget') throw new Error('Browser consumer did not decode the response');
} finally {
  if (descriptor !== undefined) Object.defineProperty(globalThis, 'fetch', descriptor);
}

globalThis.console.log('browser-packed-client-ok');
