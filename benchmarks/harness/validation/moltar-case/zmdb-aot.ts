import { addCase } from '../benchmarks';
import { aotIs, aotEquals, aotParseSafe, aotParseStrict } from './zmdb-aot-impl';

// zmdb AOT path: hand-inlined exactly as the transformer will emit (transformer
// not yet wired as a build plugin — see epic). Monomorphic, allocation-free.
addCase('zmdb-aot', 'parseSafe', d => aotParseSafe(d));
addCase('zmdb-aot', 'parseStrict', d => aotParseStrict(d));
addCase('zmdb-aot', 'assertLoose', d => { if (!aotIs(d)) throw new Error('wrong type.'); return true; });
addCase('zmdb-aot', 'assertStrict', d => { if (!aotEquals(d)) throw new Error('wrong type.'); return true; });
