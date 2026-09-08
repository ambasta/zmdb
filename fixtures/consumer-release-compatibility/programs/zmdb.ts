import assert from 'node:assert/strict';

import { Container, createToken } from 'zmdb';
import { createToken as appToken } from 'zmdb/app';
import { validate } from 'zmdb/validator';

assert.equal(createToken, appToken);
const container = new Container();
const token = createToken<string>('release');
container.register(token, 'wire-π');
assert.equal(container.resolve(token), 'wire-π');
assert.equal(validate('wire-π', { kind: 'scalar', scalar: 'string', constraints: {} }).success, true);
assert.equal(validate(17, { kind: 'scalar', scalar: 'string', constraints: {} }).success, false);
