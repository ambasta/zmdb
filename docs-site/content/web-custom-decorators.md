Stage-3 decorators have **no parameter decorators**, so there is no `createParamDecorator` equivalent and nothing to reflect. Two mechanisms cover what parameter and metadata decorators did:

1. A **plain function** that reads the typed [`Ctx`](./web-context.html).
2. A **method or class decorator** that records to `context.metadata`, read once at boot.

## Accessors are functions

```ts
import type { Ctx } from '@zmdb/web/context';

export const bearer = (ctx: Ctx): string | undefined => (ctx.headers.authorization?.startsWith('Bearer ') ? ctx.headers.authorization.slice(7) : undefined);

export const pageOf = (ctx: Ctx<Record<never, string>, unknown, { page?: string }>): number => Math.max(1, Number(ctx.query.page ?? 1) || 1);
```

```ts
@Controller('/me')
export class MeController {
  @Get('/')
  read(ctx: Ctx) {
    const viewer = principalOf(ctx); // see Authentication
    return { id: viewer.id };
  }
}
```

This is strictly better than the decorator it replaces: it is an ordinary function, so it is typed, testable in isolation, greppable, and adds nothing to the request path. `Ctx` has no `state` bag, so
an accessor derives its value from `headers`, `params`, `query` or `body` — see [Authentication](./web-authentication.html) for memoising an expensive derivation with a `WeakMap`.

## A metadata decorator

`Symbol.metadata` is the same channel `@Controller` and `@Get` use. A method decorator writes to it, and nothing at request time reads it:

```ts
const ROLES = Symbol('app.roles');

interface RolesMetadata {
  [ROLES]?: Record<string, readonly string[]>;
}

// The only writer of the ROLES slot is the decorator below, so viewing the
// record through RolesMetadata is sound — and needs no cast.
function rolesView(metadata: DecoratorMetadata): RolesMetadata {
  return metadata;
}

export function Roles(...roles: readonly string[]) {
  return function (_value: unknown, context: ClassMethodDecoratorContext): void {
    const view = rolesView(context.metadata);
    view[ROLES] = { ...view[ROLES], [String(context.name)]: roles };
  };
}

export function rolesFor(target: abstract new (...args: never[]) => unknown): Record<string, readonly string[]> {
  const metadata = target[Symbol.metadata];
  return metadata === null || metadata === undefined ? {} : (rolesView(metadata)[ROLES] ?? {});
}
```

The `rolesView` function is the repo's own pattern for this ([ARCHITECTURE.md §2.1](./architecture.html)): one narrow view function carrying the soundness argument, so no `as` appears at a call site.

```ts
@Controller('/admin')
export class AdminController {
  @Get('/stats')
  @Roles('admin')
  stats(ctx: Ctx) {
    /* … */
  }
}
```

## Reading it at boot

```ts
import { getRoutes } from '@zmdb/web/routing';

const table = getRoutes(AdminController).map(route => ({
  method: route.method,
  path: route.path,
  roles: rolesFor(AdminController)[route.handlerName] ?? [],
}));
```

One pass at startup produces a permission table you can log, assert against, or render into your API documentation.

> [!WARNING] **Nothing reads your metadata for you.** The router only consults its own routing slots, so a `@Roles('admin')` that no code reads is decoration, not a control — and it reads exactly like
> enforcement to the next person. Either wire the table above into a check, or add a test that fails when a `@Roles` route is reachable without the role.

Because the framework cannot enforce it, the [authorization](./web-authorization.html) page recommends passing the role at the call site for small surfaces. Metadata earns its keep when the table
itself is the product — an access review, generated docs, a permission matrix in your admin UI.

## Decorators that wrap the method

A method decorator can also return a replacement function, which covers the "decorator as middleware" cases:

```ts
export function Timed() {
  return function <T extends (...args: never[]) => unknown>(value: T, context: ClassMethodDecoratorContext): T {
    return function (this: unknown, ...args: never[]): unknown {
      const start = performance.now();
      try {
        return value.apply(this, args);
      } finally {
        console.log(JSON.stringify({ handler: String(context.name), ms: performance.now() - start }));
      }
    } as T;
  };
}
```

Note the `as T` — wrapping a method and re-asserting its signature is one of the few places consumer code genuinely needs an assertion, because a variadic wrapper cannot prove it preserves the
original type. An [interceptor](./web-middleware.html) does the same job without it, and composes.

Also mind the ordering: decorators apply bottom-up, so with `@Get('/') @Timed()` the routing decorator sees the class after `@Timed` has replaced the method — which is fine, since `@Get` records the
method _name_, not the function. A decorator that replaces the method and changes its name would not be.

## Class decorators compose

```ts
@Controller('/admin')
@Audited('admin-surface')
export class AdminController {}
```

Both write to the same per-class metadata object under their own symbols. Use a module-private `Symbol`, never a string key, so two libraries cannot collide.

## `Symbol.metadata` must exist

Node 26 does not expose `Symbol.metadata` natively; `@zmdb/app` installs it (and nothing else) on first import. Importing `@zmdb/web` also loads that app-owned polyfill before web decorators are
evaluated. A standalone decorator file should import `@zmdb/app` before decorated classes are evaluated.

## Design notes

- No `reflect-metadata`, no `emitDecoratorMetadata`, no design-time type emission.
- Everything a decorator computes is computed at class-definition time, so it is boot cost, not per-request cost. The repository-private `countMetadataReads` probe asserts that in a test.
- Granular imports: `@zmdb/web/context`, `@zmdb/web/routing`.

---

See also: [Typed Request Context](./web-context.html) · [Authorization](./web-authorization.html) · [Controllers & Routing](./web-controllers.html)
