import assert from 'node:assert/strict';

import { Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { createZmdbAngular } from '@zmdb/angular';

const bindings = createZmdbAngular('packed SSR client');

async function request(id, credential) {
  const parent = createEnvironmentInjector([], Injector.NULL, `packed-${id}-parent`);
  const calls = [];
  const client = {
    async getWidget(input, options) {
      calls.push({ id: input.id, credential, signal: options.signal });
      await Promise.resolve();
      return { id: input.id, name: credential };
    },
  };
  const owner = createEnvironmentInjector([bindings.provideZmdbClient(client)], parent, `packed-${id}-request`);

  try {
    const result = await new Promise((resolve, reject) => {
      runInInjectionContext(owner, () => {
        bindings.zmdbQuery({ id }, (injected, input, signal) => {
          const operation = injected.getWidget(input, { signal });
          void operation.then(resolve, reject);
          return operation;
        });
      });
    });
    return { result, calls };
  } finally {
    owner.destroy();
    parent.destroy();
  }
}

const [first, second] = await Promise.all([
  request('first', 'first-credential'),
  request('second', 'second-credential'),
]);

assert.deepEqual(first.result, { id: 'first', name: 'first-credential' });
assert.deepEqual(second.result, { id: 'second', name: 'second-credential' });
assert.equal(first.calls.length, 1);
assert.equal(second.calls.length, 1);
assert.equal(first.calls[0].credential, 'first-credential');
assert.equal(second.calls[0].credential, 'second-credential');
assert.notEqual(first.calls[0].signal, second.calls[0].signal);
process.stdout.write('request-local Angular SSR clients passed');
