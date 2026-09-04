// The suite's data model, as the IR the walker reads — generated from the one interface in
// benchmarks/harness/validation/model.ts, not written out again here. This is the honest
// runtime path: no transformer, so the validator walks that structure per call. The AOT
// path is a separate participant (`zmdb-aot`) precisely so the two are not conflated in
// the results table.
import { MOLTAR } from '../../../../../../benchmarks/harness/validation/model.generated.js';
// zmdb participant in moltar/typescript-runtime-type-benchmarks — RUNTIME path.
//
// This file is grafted into the upstream clone at cases/zmdb/src/index.ts by
// benchmarks/scripts/graft.mjs and bundled to CJS by the `compile:zmdb` script
// the patch adds. It is deliberately not upstreamed: it reaches into this
// repository's sources by relative path, which only makes sense from inside the
// submodule checkout.
//
// The relative depth below is
//   benchmarks/upstream/typescript-runtime-type-benchmarks/cases/zmdb/src
// back up to the repository root. graft.mjs asserts the target resolves before
// copying, so a moved checkout fails loudly instead of bundling nothing.
import { equals, is, validate } from '../../../../../../packages/aot-validator/src/utilities/index.js';

export function looseIs(data: unknown): boolean {
  return is(data, MOLTAR);
}

export function strictEquals(data: unknown): boolean {
  return equals(data, MOLTAR);
}

export function parseSafe(data: unknown): unknown {
  const result = validate(data, MOLTAR);
  if (!result.success) throw new Error('wrong type.');
  return result.data;
}

export function parseStrict(data: unknown): unknown {
  if (!equals(data, MOLTAR)) throw new Error('wrong type.');
  return data;
}
