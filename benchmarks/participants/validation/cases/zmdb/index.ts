import { addCase } from '../../benchmarks';
import { looseIs, parseSafe, parseStrict, strictEquals } from './build';

// zmdb's runtime (descriptor-driven) validator. Registered under `zmdb`; the
// transformer-inlined path is registered separately as `zmdb-aot` so a reader of
// the results table can see the cost of not running the transformer.
addCase('zmdb', 'parseSafe', data => parseSafe(data));

addCase('zmdb', 'parseStrict', data => parseStrict(data));

addCase('zmdb', 'assertLoose', data => {
  if (!looseIs(data)) throw new Error('wrong type.');
  return true;
});

addCase('zmdb', 'assertStrict', data => {
  if (!strictEquals(data)) throw new Error('wrong type.');
  return true;
});
