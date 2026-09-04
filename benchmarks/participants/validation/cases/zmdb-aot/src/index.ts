// zmdb participant in moltar/typescript-runtime-type-benchmarks — AOT path.
//
// Nothing is generated here. The transformer's output for the suite's data model is
// generated once, in the repository, by `benchmarks/scripts/generate-validation-model.mjs`,
// and this participant re-exports it — so the number this suite publishes and the number
// the local harness publishes come from the same emitted functions.
//
// This file used to run the transform itself, over a type spelled out as a string, and
// then hand-write the strict variant beside it. Two generators for one artifact is two
// things to keep in agreement, and the hand-written half was the part nobody could check.
//
// Relative depth: this file lives at
//   benchmarks/upstream/typescript-runtime-type-benchmarks/cases/zmdb-aot/src
// so six levels up is the repository root.
export {
  aotEquals,
  aotIs,
  aotParseSafe,
  aotParseStrict,
} from '../../../../../../benchmarks/harness/validation/aot.generated.js';
