import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { isMessage, validateMessage } from './model.js';

const require = createRequire(import.meta.url);
for (const name of ['@zmdb/compiler', '@zmdb/cli', '@zmdb/migrations', 'typescript']) {
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
}
for (const name of ['model.js', 'model.zmdb.generated.js']) {
  const source = await readFile(new URL(name, import.meta.url), 'utf8');
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(
    match => match[1],
  );
  for (const specifier of imports) {
    assert.doesNotMatch(
      specifier,
      /^(?:@zmdb\/(?:aot-validator|schema-core|query-compiler|repository|compiler|cli|migrations)|typescript)(?:\/|$)/,
    );
  }
}
assert.equal(isMessage({ id: 7, address: 'a@example.test' }), true);
assert.equal(isMessage({ id: '7', address: 'a@example.test' }), false);
const accepted = validateMessage({ id: 7, address: 'a@example.test' });
assert.equal(accepted.success, true);
const rejected = validateMessage({ id: '7', address: 'a@example.test' });
assert.equal(rejected.success, false);
assert.equal(rejected.errors[0].path, 'input.id');
