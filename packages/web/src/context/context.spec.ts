// Tests (#259) for typed Ctx + path-param derivation — RED first (context
// exports don't exist yet). Type-level derivation via expectTypeOf, plus runtime
// extractParams. Per packages/web/src/context/SPEC.md.
import { describe, it, expect, expectTypeOf } from 'vitest';
import { extractParams, type PathParams, type Ctx, type HandlerFor } from './index.ts';

describe('@zmdb/web context: PathParams derivation (type-level)', () => {
  it('derives a single param', () => {
    expectTypeOf<PathParams<'/users/:id'>>().toEqualTypeOf<{ id: string }>();
  });

  it('derives multiple params', () => {
    expectTypeOf<PathParams<'/users/:id/posts/:postId'>>().toEqualTypeOf<{ id: string; postId: string }>();
  });

  it('derives no params for a static path', () => {
    expectTypeOf<PathParams<'/health'>>().toEqualTypeOf<Record<never, string>>();
  });

  it('derives a trailing param', () => {
    expectTypeOf<PathParams<'/files/:path'>>().toEqualTypeOf<{ path: string }>();
  });
});

describe('@zmdb/web context: Ctx + HandlerFor (type-level)', () => {
  it('binds ctx.params to the route string', () => {
    const handler: HandlerFor<'/users/:id', { name: string }> = (ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
      expectTypeOf(ctx.body).toEqualTypeOf<{ name: string }>();
      return ctx.params.id;
    };
    expect(handler).toBeTypeOf('function');
  });

  it('Ctx defaults are empty/unknown', () => {
    expectTypeOf<Ctx>().toMatchTypeOf<{ params: Record<never, string>; body: unknown }>();
  });
});

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
