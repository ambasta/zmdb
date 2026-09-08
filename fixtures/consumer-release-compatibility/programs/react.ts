import assert from 'node:assert/strict';

import { createZmdbReact } from '@zmdb/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const bindings = createZmdbReact<{ readonly value: string }>();
function Child() {
  return createElement('span', null, bindings.useZmdbClient().value);
}
const render = (value: string) =>
  renderToStaticMarkup(createElement(bindings.ZmdbClientProvider, { client: { value } }, createElement(Child)));
assert.equal(render('first-π'), '<span>first-π</span>');
assert.equal(render('second'), '<span>second</span>');
