import { expect, it } from 'vitest';

import { CALLEES } from '../transformer.js';

it('recognises the protobuf callees in the transformer', async () => {
  const names = ['protoDecode', 'protoDescriptor', 'protoEncode'] as const;
  expect([...CALLEES]).toEqual(expect.arrayContaining([...names]));

  // A name in CALLEES is not enough: the untransformed development path must
  // still resolve a callable export, which is the invariant the existing literal
  // CALLEES test enforces for every other entry.
  const surface: unknown = await import('../index.js');
  for (const name of names) {
    expect(typeof Reflect.get(Object(surface), name), `${name} is in CALLEES but is not exported`).toBe('function');
  }
});
