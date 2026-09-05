import { createZmdbVue } from '@zmdb/vue';
import { createApp, effectScope, shallowRef } from 'vue';

interface BrowserClient {
  load(input: { readonly id: string }, signal: AbortSignal): Promise<{ readonly id: string }>;
}

const calls: string[] = [];
const client: BrowserClient = {
  async load(input, signal) {
    if (signal.aborted) throw signal.reason;
    calls.push(input.id);
    return { id: input.id };
  },
};

const zmdb = createZmdbVue<BrowserClient>('@zmdb/vue packed browser');
const app = createApp({ render: () => null });
app.use(zmdb.createZmdbPlugin(client));
const scope = effectScope();
const input = shallowRef({ id: 'browser' });
const query = app.runWithContext(() =>
  scope.run(() => zmdb.useZmdbQuery(input, (api, selected, signal) => api.load(selected, signal))),
);
if (query === undefined) throw new Error('packed browser query did not activate');
while (query.loading.value) await Promise.resolve();
if (query.data.value?.id !== 'browser') throw new Error('packed browser query returned the wrong data');
scope.stop();

process.stdout.write(JSON.stringify({ calls, result: query.data.value }));
