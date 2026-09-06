There is no `AuthGuard`, no strategy registry and no `@nestjs/passport` equivalent. Authentication is a function you write and call: read a credential from `ctx.headers`, verify it, and get a
principal back.

The one structural constraint to design around: **`Ctx` is readonly and has no `state` bag**. It carries `params`, `body`, `query`, `headers`, `method`, `path` and optional `span`. The span is
framework-owned trace context, not a general extension point, so a guard still cannot attach a principal for the handler to pick up later.

## Verify where you use it

```ts
import type { Ctx } from '@zmdb/web/context';

export interface Principal {
  readonly id: number;
  readonly roles: readonly string[];
}

export function principalOf(ctx: Ctx): Principal {
  const header = ctx.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) throw new Unauthenticated();
  const principal = verifyJwt(header.slice(7)); // your verifier
  if (principal === undefined) throw new Unauthenticated();
  return principal;
}
```

```ts
@Controller('/me')
export class MeController {
  @Get('/')
  read(ctx: Ctx) {
    const viewer = principalOf(ctx);
    return { id: viewer.id, roles: viewer.roles };
  }
}
```

Explicit, typed, and impossible to forget silently — a handler that never calls `principalOf` has no `viewer` to pass to the query.

## Verify once per request

Stateless JWT verification is cheap enough to repeat. A session lookup that hits the database is not, and a handler plus an [authorization](./web-authorization.html) check would do it twice. The
router builds a **fresh `ctx` object per request**, so it is a sound `WeakMap` key:

```ts
const cache = new WeakMap<object, Principal>();

export function principalOf(ctx: Ctx): Principal {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const principal = verify(ctx.headers.authorization);
  cache.set(ctx, principal);
  return principal;
}
```

`WeakMap` and not `Map`: the entry disappears with the request, so there is no leak and no chance of a stale principal being served to a later request.

> [!WARNING] Never key such a cache on anything shared — a controller field, a module-level `Map` keyed by user id, a `let currentUser`. Under concurrency, request B overwrites request A's principal
> between A's `await` points, and A finishes the request as B. This is the single most damaging bug shape in this area.

## As a Guard

`Guard` is a real interface if you prefer the shape:

```ts
import type { Guard, AnyCtx } from '@zmdb/web/middleware';

export const authenticated: Guard = {
  canActivate(ctx: AnyCtx): boolean {
    try {
      principalOf(ctx); // memoised, so the handler's call is free
      return true;
    } catch {
      return false;
    }
  },
};
```

Apply it to every registered route, one controller, or one handler:

```ts
const appRouter = createRouter({ guardRegistry: { app: [authenticated] } });
appRouter.register(new AccountController());

// Controller-specific:
const controllerRouter = createRouter({
  guardRegistry: { controllers: { AdminController: [authenticated] } },
});
controllerRouter.register(new AdminController());

// Handler-specific:
const routeRouter = createRouter();
routeRouter.register(new AccountController(), { profile: { guards: [authenticated] } });
```

Effective guards run app → controller → route. A guard returning `false` produces a 403 and the handler does not run. `@Public()` bypasses inherited app/controller guards and cannot also declare a
route guard or a non-empty explicit security requirement.

`createApp(AppModule, { guardRegistry })` applies app-wide and controller-specific guards to its startup-built router. Module bootstrap still has no per-route registration options, so handler-specific
guards and automatic body validation require an explicitly constructed router or a check in the handler.

## Getting a 401 out

Return the status rather than throwing it — a thrown error can only become a 400 or a 500:

```ts
if (!user) return json({ error: 'unauthenticated' }, { status: 401 });
if (!user.canRead(id)) return json({ error: 'forbidden' }, { status: 403 });
```

If you would rather keep handlers throwing domain errors, map them once in your adapter instead:

```ts
import { bodyText } from '@zmdb/web';

const STATUS = new Map<string, number>([
  ['Unauthenticated', 401],
  ['Forbidden', 403],
]);

createServer(async (req, res) => {
  try {
    const out = await app.handle(await webRequest(req));
    res.writeHead(out.status, { ...out.headers }).end(await bodyText(out));
  } catch (error) {
    const status = STATUS.get(errorName(error)) ?? 500;
    res.writeHead(status, { 'www-authenticate': 'Bearer' }).end('{"error":"unauthenticated"}');
  }
});
```

This custom error mapper buffers a streamed response. Use `toNodeHandler` when the route must preserve streaming, backpressure and cancellation.

See [Exception Filters](./web-exception-filters.html) for the full pattern. `webRequest(req)` is the `WebRequest` build the adapter has to do itself — there is no `toWebRequest` to import; it is
written out in [Request Lifecycle](./web-request-lifecycle.html).

## Verifying a JWT properly

zmdb bundles no JWT library — [zero runtime dependencies](./why-zmdb.html) — so this is your library's job. What it must check, all of it:

| Claim                       | Why                                                             |
| --------------------------- | --------------------------------------------------------------- |
| signature                   | the whole point                                                 |
| `alg` against an allow-list | `alg: none` and RS256→HS256 confusion are classic full bypasses |
| `exp`                       | an unexpiring token is a permanent credential                   |
| `iss`, `aud`                | a valid token for another service is not valid for yours        |
| `kid` against your key set  | not against a URL from the token                                |

> [!WARNING] Never decode without verifying. `JSON.parse(atob(parts[1]))` gives you a perfectly readable, entirely attacker-controlled object. Every field in an unverified token — including `sub` and
> `roles` — is a value the caller chose.

Use a maintained library and let it enforce the list above; hand-rolled verification is the wrong place to save a dependency.

## API keys and passwords

```ts
import { timingSafeEqual } from 'node:crypto';

function keyMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

`timingSafeEqual` after a length check, never `===` — string comparison returns early on the first differing byte, which leaks the prefix. And `timingSafeEqual` throws on a length mismatch, hence the
guard.

For passwords, `node:crypto`'s `scrypt` is built in and sufficient; store the salt with the hash and compare with `timingSafeEqual`. Never a bare SHA-256, and never your own construction.

## Logging

```ts
console.log(JSON.stringify({ requestId, sub: viewer.id, route: '/me' }));
```

Log the subject, never the credential. An `authorization` header in your logs is a live credential in a system with different access controls than your authentication store — and log aggregators are
widely readable inside a company. Redact the header at the adapter if you log headers at all.

## Testing

```ts
await using app = createTestApp(AppModule, {
  overrides: [{ token: VERIFIER, useValue: () => ({ id: 1, roles: ['admin'] }) }],
});

const out = await app.request({ method: 'GET', path: '/me', headers: { authorization: 'Bearer x' } });
```

Put the verifier behind a token so tests substitute it. Then assert the negative cases too — no header, a malformed header, an expired token — because those are the paths that ship broken.

## What it would take

Application and controller guards now work through both `createRouter` and `createApp`; route-specific guards work through explicit router registration. A typed way for a guard to hand a principal to
the handler still needs a per-request bag or `Ctx` extension point.

---

See also: [Authorization](./web-authorization.html) · [Cookies & Sessions](./web-cookies-sessions.html) · [Middleware](./web-middleware.html)
