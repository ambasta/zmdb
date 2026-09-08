import assert from 'node:assert/strict';

import { createZmdbSolid } from '@zmdb/solid';
import { createComponent, createRoot } from 'solid-js';

const bindings = createZmdbSolid<{ readonly value: string }>();
const seen: string[] = [];
for (const value of ['first-π', 'second'])
  createRoot(dispose => {
    try {
      createComponent(bindings.Provider, {
        client: { value },
        get children() {
          seen.push(bindings.useClient().value);
          return undefined;
        },
      });
    } finally {
      dispose();
    }
  });
assert.deepEqual(seen, ['first-π', 'second']);
