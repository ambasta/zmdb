import { addCase } from '../../benchmarks';
import { aotEquals, aotIs, aotParseSafe, aotParseStrict } from './build';

// zmdb with the AOT transformer applied — the path a production build takes. The
// validators in ./build are transformer output; see src/index.ts.
addCase('zmdb-aot', 'parseSafe', data => aotParseSafe(data));

addCase('zmdb-aot', 'parseStrict', data => aotParseStrict(data));

addCase('zmdb-aot', 'assertLoose', data => {
  if (!aotIs(data)) throw new Error('wrong type.');
  return true;
});

addCase('zmdb-aot', 'assertStrict', data => {
  if (!aotEquals(data)) throw new Error('wrong type.');
  return true;
});
