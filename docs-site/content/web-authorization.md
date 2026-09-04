There is no `RolesGuard` and no `@Roles()` the framework reads. Authorization is
a check you call, and — because `Ctx` carries no `route` and no `state` — the
required permission is a value at the call site rather than metadata looked up
per request.

That turns out to be an advantage: the check is visible in the handler, and a
typo is a compile error.

## Coarse checks: roles

```ts
export class Forbidden extends Error {
  override readonly name = 'Forbidden';
}

export function requireRole(viewer: Principal, role: string): void {
  if (!viewer.roles.includes(role)) throw new Forbidden(`requires ${role}`);
}
```

```ts
@Controller('/admin')
export class AdminController {
  @Get('/stats')
  stats(ctx: Ctx) {
    const viewer = principalOf(ctx);
    requireRole(viewer, 'admin');
    return this.reports.summary();
  }
}
```

A `Forbidden` thrown by a handler remains an ordinary error and becomes a 500
unless an adapter maps it. A guard returning `false` produces the router's 403,
and a handler can return `json(value, { status: 403 })` directly. See
[Exception Filters](./web-exception-filters.html).

Roles as a `readonly string[]` is fine at this scale. A union type is better:

```ts
type Role = 'admin' | 'editor' | 'viewer';
function requireRole(viewer: Principal, role: Role): void {
  /* … */
}
```

Now `requireRole(viewer, 'admn')` does not compile, which is a class of
production incident removed at zero cost.

## Fine checks: put ownership in the WHERE clause

The important half of authorization is not the role check, it is this:

```ts
@Get('/:id')
async read(ctx: Ctx<{ id: string }>) {
  const viewer = principalOf(ctx);
  const post = await this.posts.findOne({
    id: { eq: Number(ctx.params.id) },
    author_id: { eq: viewer.id },
  });
  if (post === undefined) throw new NotFound();
  return post;
}
```

Not this:

```ts
const post = await this.posts.findById(Number(ctx.params.id)); // wrong
if (post.author_id !== viewer.id) throw new Forbidden();
```

Three reasons the first form is better:

- **It cannot be forgotten halfway.** A later refactor that drops the `if` leaves
  a working endpoint that serves anyone's data. Dropping the `where` clause
  changes the query, which a test notices.
- **It does not disclose existence.** The post-load check answers "this row
  exists but is not yours", which is enough to enumerate ids. The filtered query
  answers "no such row".
- **It composes with lists.** `list()` and `aggregate()` take the same `where`, so
  the same predicate protects the collection endpoints where per-row checks are
  most often missed.

## Multi-tenancy is the same rule

Every query in a tenanted application carries the tenant:

```ts
where: { tenant_id: { eq: viewer.tenantId }, status: { eq: 'active' } }
```

A missing `tenant_id` is a cross-tenant data leak, and it will not show up in a
single-tenant test fixture. Two places this is easy to lose:

- **Cursor pagination.** A [base64 cursor](./guide-cursor-pagination.html) is encoding, not
  authentication. Anyone can craft one; the tenant filter in the `where` is what
  protects the page.
- **Caching.** A [cache key](./web-caching.html) without the tenant serves one
  tenant's rows to another.

The structural fix is to build the repository [per request with the tenant
already bound](./web-request-context.html), so the filter is applied by
construction rather than by remembering. Seed your test data with **two** tenants
and assert the second never appears.

## Fail closed

Default to denied, and make "public" a decision someone wrote down:

```ts
const PUBLIC = new Set(['GET /health', 'POST /auth/login']);
```

Then a test that enumerates the real routes, so a new endpoint cannot quietly
join the unauthenticated set:

```ts
import { getRoutes } from '@zmdb/web/routing';

it('every route is authenticated or explicitly public', async () => {
  for (const route of [...getRoutes(PostsController), ...getRoutes(AdminController)]) {
    const key = `${route.method} ${route.path}`;
    if (PUBLIC.has(key)) continue;
    const out = await app.request({ method: route.method, path: route.path.replace(/:\w+/g, '1'), headers: {} });
    expect(out.status).not.toBe(200);
  }
});
```

`getRoutes` reads the same metadata the router uses, so this test cannot drift
from the routing table. A convention nobody checks is not a control.

## 403 or 404

For a resource whose existence is itself sensitive — a private repository, another
tenant's record — return **404**. A 403 confirms the id is real, which is enough
for enumeration. For an operation the caller is simply not permitted to perform,
403 is the honest answer and the more useful one.

Pick per endpoint, deliberately, and be consistent within a resource: a 404 on
`GET` and a 403 on `DELETE` for the same id leaks what the 404 was hiding.

## Declaring permissions as metadata

If you want the roles declared as a decorator rather than passed at the call
site, the `Symbol.metadata` channel is available and the router will ignore it —
see [Custom Decorators](./web-custom-decorators.html) for a `@Roles()` that
records to metadata and a boot-time read via `getRoutes`.

It buys you a machine-readable permission table (useful for documentation and for
an access review) at the cost of a lookup keyed by handler name. Worth it for a
large surface; for a handful of admin routes, a literal argument is clearer.

## Guard-level enforcement

Register a permission guard in `GuardRegistry.app`, under a controller class
name, or under the handler name to enforce it without a call inside each
handler. Effective guards run app → controller → route. Passing a typed
principal from a guard into the handler still needs a typed request-state
channel; today the guard and handler can share a request-keyed cache.
Row-level enforcement — a filter applied to every query for an entity — needs
schema-level [entity filters](./entity-filters.html).

---

See also: [Authentication](./web-authentication.html) · [Custom Decorators](./web-custom-decorators.html) · [Request Context](./web-request-context.html)
