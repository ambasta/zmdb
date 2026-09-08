import assert from 'node:assert/strict';

import { createQueryStore } from '@zmdb/svelte';
import { get } from 'svelte/store';

const query = createQueryStore({ value: 'wire-π' }, 2, (client, count, signal) => {
  assert.equal(signal.aborted, false);
  return Promise.resolve(client.value.repeat(count));
});
const unsubscribe = query.subscribe(() => {});
try {
  await query.refresh();
  assert.equal(get(query).data, 'wire-πwire-π');
} finally {
  unsubscribe();
  query.destroy();
}
await assert.rejects(query.refresh(), /destroyed/);
