import { createZmdbVue } from '@zmdb/vue';
import { createSSRApp } from 'vue';

interface SsrClient {
  readonly credential: string;
}

const zmdb = createZmdbVue<SsrClient>('@zmdb/vue packed SSR');

function requestClient(credential: string): SsrClient {
  const client = Object.freeze({ credential });
  const app = createSSRApp({ render: () => null });
  app.use(zmdb.createZmdbPlugin(client));
  return app.runWithContext(() => zmdb.useZmdbClient());
}

const clients = await Promise.all([
  Promise.resolve().then(() => requestClient('first')),
  Promise.resolve().then(() => requestClient('second')),
]);
if (clients[0]?.credential !== 'first' || clients[1]?.credential !== 'second') {
  throw new Error(`packed SSR clients shared state: ${JSON.stringify(clients)}`);
}

process.stdout.write(JSON.stringify({ credentials: clients.map(client => client.credential) }));
