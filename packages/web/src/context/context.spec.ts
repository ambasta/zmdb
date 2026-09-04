// Tests (#259) for typed Ctx + path-param derivation: runtime `extractParams`.
// The type-level half (`PathParams`/`Ctx`/`HandlerFor`) lives in
// `context.type-test.ts`, which `yarn typecheck` compiles.
// Per packages/web/src/context/SPEC.md.
import { describe, it, expect } from 'vitest';

import { compilePattern, countSegments, extractParams, matchCompiled } from './index.js';

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

  it('ignores leading, trailing and duplicated slashes', () => {
    expect(extractParams('/health', 'health')).toEqual({});
    expect(extractParams('/health', '/health/')).toEqual({});
    expect(extractParams('/users/:id', '//users//42//')).toEqual({ id: '42' });
    expect(extractParams('/', '/')).toEqual({});
    expect(extractParams('/', '')).toEqual({});
  });

  it('does not confuse a param value with a same-length static segment', () => {
    expect(extractParams('/users/me', '/users/me')).toEqual({});
    expect(extractParams('/users/me', '/users/xx')).toBeUndefined();
    expect(extractParams('/users/me', '/users/m')).toBeUndefined();
    expect(extractParams('/users/me', '/users/mex')).toBeUndefined();
  });
});

describe('@zmdb/web context: compiled matching', () => {
  it('counts non-empty segments', () => {
    expect(countSegments('/')).toBe(0);
    expect(countSegments('')).toBe(0);
    expect(countSegments('/a')).toBe(1);
    expect(countSegments('/a/b')).toBe(2);
    expect(countSegments('//a//b//')).toBe(2);
  });

  it('records segment count and param names once, at compile time', () => {
    const compiled = compilePattern('/users/:id/posts/:postId');
    expect(compiled.segmentCount).toBe(4);
    expect(compiled.names).toEqual(['id', 'postId']);
    expect(compiled.literals).toEqual(['users', null, 'posts', null]);
  });

  it('agrees with extractParams, and is reusable across many paths', () => {
    const compiled = compilePattern('/users/:id');
    expect(matchCompiled(compiled, '/users/42')).toEqual({ id: '42' });
    expect(matchCompiled(compiled, '/users/7')).toEqual({ id: '7' });
    expect(matchCompiled(compiled, '/orders/42')).toBeUndefined();
    // Reuse must not let one match's params bleed into the next.
    expect(matchCompiled(compiled, '/users/9')).toEqual({ id: '9' });
  });

  it('shares one frozen params object for patterns with no params', () => {
    const compiled = compilePattern('/health');
    const first = matchCompiled(compiled, '/health');
    const second = matchCompiled(compiled, '/health');
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
