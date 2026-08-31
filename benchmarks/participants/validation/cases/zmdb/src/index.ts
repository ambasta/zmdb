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
import {
  equals,
  is,
  validate,
  type TypeDescriptor,
} from '../../../../../../packages/aot-validator/src/utilities/index.ts';

// The suite's fixed data model, as a descriptor. This is the honest runtime
// path: no transformer, so the validator walks this structure per call. The AOT
// path is a separate participant (`zmdb-aot`) precisely so the two are not
// conflated in the results table.
const descriptor: TypeDescriptor = {
  kind: 'object',
  fields: {
    number: { kind: 'number' },
    negNumber: { kind: 'number' },
    maxNumber: { kind: 'number' },
    string: { kind: 'string' },
    longString: { kind: 'string' },
    boolean: { kind: 'boolean' },
    deeplyNested: {
      kind: 'object',
      fields: {
        foo: { kind: 'string' },
        num: { kind: 'number' },
        bool: { kind: 'boolean' },
      },
    },
  },
};

export function looseIs(data: unknown): boolean {
  return is(data, descriptor);
}

export function strictEquals(data: unknown): boolean {
  return equals(data, descriptor);
}

export function parseSafe(data: unknown): unknown {
  const result = validate(data, descriptor);
  if (!result.success) throw new Error('wrong type.');
  return result.data;
}

export function parseStrict(data: unknown): unknown {
  if (!equals(data, descriptor)) throw new Error('wrong type.');
  return data;
}
