import assert from 'node:assert/strict';

import { Container, createToken, UnresolvedTokenError } from '@zmdb/app';

const token = createToken<{ readonly value: string }>('release');
const container = new Container();
assert.throws(() => container.resolve(token), UnresolvedTokenError);
let calls = 0;
container.registerFactory(token, () => {
  calls++;
  return { value: 'wire-π' };
});
assert.equal(container.resolve(token), container.resolve(token));
assert.equal(container.resolve(token).value, 'wire-π');
assert.equal(calls, 1);
