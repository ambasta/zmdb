import { addCase } from '../../benchmarks';
import { looseIs, parseStrict, strictEquals } from './build';

// zmdb's runtime (descriptor-driven) validator. Registered under `zmdb`; the
// transformer-inlined path is registered separately as `zmdb-aot` so a reader of
// the results table can see the cost of not running the transformer.
// Upstream parseSafe must remove unknown root and nested keys. The public
// validator preserves its input, so that unsupported cell is not registered.

addCase('zmdb', 'parseStrict', data => parseStrict(data));

addCase('zmdb', 'assertLoose', data => {
  if (!looseIs(data)) throw new Error('wrong type.');
  return true;
});

addCase('zmdb', 'assertStrict', data => {
  if (!strictEquals(data)) throw new Error('wrong type.');
  return true;
});
