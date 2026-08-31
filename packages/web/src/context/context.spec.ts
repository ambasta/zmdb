// Tests (#259) for typed Ctx + path-param derivation: runtime `extractParams`.
// The type-level half (`PathParams`/`Ctx`/`HandlerFor`) lives in
// `context.type-test.ts`, which `yarn typecheck` compiles.
// Per packages/web/src/context/SPEC.md.
import { describe, it, expect } from 'vitest';

import { extractParams } from './index.ts';

describe('@zmdb/web context: extractParams (runtime)', () => {
  it('extracts params from a matching path', () => {
    expect(extractParams('/users/:id', '/users/42')).toEqual({ id: '42' });
    expect(extractParams('/users/:id/posts/:postId', '/users/1/posts/7')).toEqual({ id: '1', postId: '7' });
  });

  it('returns an empty object for a static match', () => {
    expect(extractParams('/health', '/health')).toEqual({});
  });

  it('returns undefined on a mismatch', () => {
    expect(extractParams('/users/:id', '/orders/42')).toBeUndefined();
    expect(extractParams('/users/:id', '/users/1/extra')).toBeUndefined();
    expect(extractParams('/users/:id/posts', '/users/1')).toBeUndefined();
  });
});
