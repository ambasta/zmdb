// Type-level tests for `PathParams`/`Ctx`/`HandlerFor` (#259). No runtime code:
// a *compilation* gate run by `yarn typecheck`, and therefore by CI.
//
// Path-param derivation is a pure type-level feature, so the `expectTypeOf`
// blocks that used to live in `context.spec.ts` checked nothing at all — vitest
// only executes those files, where `expectTypeOf(...)` is a no-op.
import type { Equal, Expect } from '@zmdb/schema-core';

import type { Ctx, HandlerFor, PathParams } from './index.ts';

// --- PathParams ------------------------------------------------------------
export type _Path1 = Expect<Equal<PathParams<'/users/:id'>, { id: string }>>;
export type _Path2 = Expect<Equal<PathParams<'/users/:id/posts/:postId'>, { id: string; postId: string }>>;
export type _Path3 = Expect<Equal<PathParams<'/health'>, Record<never, string>>>;
export type _Path4 = Expect<Equal<PathParams<'/files/:path'>, { path: string }>>;
// A param followed by a static segment still resolves (the recursive branch).
export type _Path5 = Expect<Equal<PathParams<'/users/:id/orders'>, { id: string }>>;

// --- Ctx / HandlerFor ------------------------------------------------------
export type _Ctx1 = Expect<Equal<Ctx['params'], Record<never, string>>>;
export type _Ctx2 = Expect<Equal<Ctx['body'], unknown>>;
export type _Ctx3 = Expect<Equal<Ctx<{ id: string }, { name: string }>['body'], { name: string }>>;

// `HandlerFor` binds `ctx.params` to the route string: the handler below needs no
// cast to read `id`, and reading an undeclared param is a compile error.
export const handler: HandlerFor<'/users/:id', { name: string }, Record<never, string>, string> = ctx => {
  const _params: { id: string } = ctx.params;
  const _body: { name: string } = ctx.body;
  return ctx.params.id;
};
declare const ctx: Parameters<HandlerFor<'/users/:id/posts/:postId'>>[0];
export type _Handler1 = Expect<Equal<(typeof ctx)['params'], { id: string; postId: string }>>;
// @ts-expect-error — 'slug' is not a param of this route.
export const _undeclaredParam = ctx.params.slug;
