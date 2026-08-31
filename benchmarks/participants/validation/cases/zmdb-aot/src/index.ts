// Re-exports the generated (transformer-produced) validators so esbuild has a
// single bundle entry point. `generated.ts` is written by src/generate.ts and is
// not checked in — regenerating it is part of `compile:zmdb-aot`.
export { aotEquals, aotIs, aotParseSafe, aotParseStrict } from './generated.ts';
