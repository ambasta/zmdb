> **ToDo / feature gap.** `OpenApiOptions` has two fields, `info` and `schemas`.
> There is no `securitySchemes`, no `security`, and no `@ApiBearerAuth`
> equivalent — the generated `OpenApiDocument` has no `components` section at all.
>
> The scheme types, how a guard declares what it enforces, and the strictness rule
> are frozen in `packages/web/src/openapi/SPEC.md`. The CI check further down this
> page is close to what ships, and the freeze explains what it changes.

## Why it matters

A spec without security declarations tells a client generator that every endpoint is public. Generated clients then have no auth parameter, Swagger UI has no "Authorize" button, and a reviewer reading the spec cannot tell which routes are protected. The endpoints are still protected — your [guard](./web-middleware.html) or handler check does that — but the contract is silent about it, which is the kind of gap that gets a public API mis-integrated.

## Workaround — add it after generation

The document is a plain object, so this is a few lines and belongs next to `toOpenApi`:

```ts
import { toOpenApi, type OpenApiDocument } from '@zmdb/web/openapi';

const doc = toOpenApi(CONTROLLERS, { info, schemas });

const withSecurity = {
  ...doc,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
};
```

A top-level `security` applies to every operation. Opt a route out explicitly:

```ts
const login = withSecurity.paths['/auth/login']?.post;
if (login !== undefined) Object.assign(login, { security: [] });
```

`security: []` on an operation means "no authentication required" and overrides the document default. Getting this backwards — omitting the key rather than setting an empty array — leaves the route documented as protected, which is the safer direction to be wrong.

That last sentence is only true _because_ of the top-level default, and the freeze drops the top-level `security` for exactly that reason: with a document-level default, "this route inherits it" and "nobody wrote anything for this route" are the same document text — an absent key — so every audit question needs the default in hand. Once the requirement is derived rather than typed, writing it on every operation costs nothing, and a document whose every operation states its own security can be read a line at a time. Keep the top-level default for as long as you are post-processing by hand; it is the right shape for a workaround and the wrong shape for generated output.

## Deriving it from the routes you actually protect

Hand-maintaining the exception list drifts. If your guards are per-route, key off the same data:

```ts
const PUBLIC = new Set(['AuthController.login', 'AuthController.register', 'HealthController.live']);

for (const C of CONTROLLERS) {
  for (const r of getRoutes(C)) {
    if (!PUBLIC.has(`${C.name}.${r.handlerName}`)) continue;
    const op = doc.paths[r.path.replace(/:([^/]+)/g, '{$1}')]?.[r.method.toLowerCase()];
    if (op !== undefined) Object.assign(op, { security: [] });
  }
}
```

Then the test that makes it trustworthy:

```ts
it('every route is either guarded or explicitly public', () => {
  for (const C of CONTROLLERS) {
    for (const r of getRoutes(C)) {
      const key = `${C.name}.${r.handlerName}`;
      expect(PUBLIC.has(key) || GUARDED.has(key)).toBe(true);
    }
  }
});
```

A new route now fails CI until someone decides whether it is public. That is a stronger control than a decorator, because it cannot be forgotten.

The freeze keeps that control and moves it into `toOpenApi`, where it runs whether or not anybody wrote the test: with `strictSecurity` on — the default — a route with neither a guard nor an explicit `@Public()` throws at generation, naming the controller and the handler. The `PUBLIC` set above becomes the `@Public()` decorator and the `GUARDED` set becomes the guards themselves.

## Common scheme declarations

```ts
// Bearer / JWT
bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }

// API key in a header
apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' }

// Cookie session
session: { type: 'apiKey', in: 'cookie', name: 'sid' }

// OAuth 2 authorization code
oauth2: {
  type: 'oauth2',
  flows: {
    authorizationCode: {
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: { 'posts:read': 'Read posts', 'posts:write': 'Write posts' },
    },
  },
}
```

> [!WARNING]
> Never put a real key, token, client secret or `example` credential in the spec.
> Specs get committed, published to a docs site and pasted into issues. A
> `securitySchemes` block describes _where_ the credential goes; it never contains
> one.

## Scopes are documentation, not enforcement

`security: [{ oauth2: ['posts:write'] }]` on an operation documents a required scope. Nothing in zmdb reads it — the enforcement is your guard or handler check, and the spec and the code can disagree. If you declare scopes, the test above is the only thing keeping them true.

## What it would take

`OpenApiOptions` gains `securitySchemes`, and `OpenApiDocument` gains an optional `components` — a type change on a public interface, emitted only when a scheme is declared, so a document generated by today's callers is byte-for-byte what it is now.

The per-route security does **not** go on `RouteSchemas`, which is what an earlier version of this section suggested. `RouteSchemas` is keyed by route path and two methods on one path share one entry, whereas security is per operation. It goes on `RouteOptions` — the per-handler record `router.register(controller, options)` already accepts — alongside the guards:

```ts
const ROUTES = {
  UsersController: { list: { guards: [auth] }, create: { guards: [auth, requireWrite] } },
  AuthController: { login: {} },
};

for (const C of CONTROLLERS) router.register(new C(), ROUTES[C.name] ?? {});
const doc = toOpenApi(CONTROLLERS, { info, schemas, securitySchemes: SCHEMES, routes: ROUTES });
```

> [!IMPORTANT]
> `register` takes an **instance** and `toOpenApi` takes either, so a `CONTROLLERS` array of
> classes — which is what `getRoutes(C)` and `${C.name}` above want — has to be constructed
> for the router. `router.register(SomeClass, …)` registers zero routes and throws nothing,
> so every request 404s; and `SomeClass.constructor.name` is `'Function'`, so keying `ROUTES`
> off it silently drops every per-route option.

A guard declares what it enforces with a `readonly enforces = { scheme: 'bearerAuth', scopes: ['posts:write'] }`, and the operation's `security` is the union of its guards' declarations.

**The larger question — derive from the guard, or declare twice — resolves better than "derived".** The router and the generator read _the same object_, so there is nothing to keep in step and a disagreement is not detectable so much as unwritable. That is why the guards live in a record rather than behind a `@UseGuards` decorator: a decorator can only record a _class_, and `enforces` is a property of the instance, so reading it would mean constructing guards at generation time — running the injector in a step that is meant to be build-time and reflection-free.

It does mean guards are configured next to the module wiring rather than beside the handler, so a reviewer reading a controller does not see them. `@Public()` stays a decorator on the handler for that reason: the claim that a route needs _no_ protection is the one a reviewer has to be able to see without opening another file.

Four other decisions worth knowing, because three of them differ from what this page recommends above:

- **Several guards on one route emit one requirement object, an AND.** That is forced, not chosen: `runChain` loops over the guards and rejects on the first `false`, so every guard must pass. The array-of-objects spelling would tell a generated client that satisfying any one of them is enough — a document understating what the code enforces, which is the failure this whole page is about.
- **`mutualTLS` is included** — it is an OpenAPI 3.1 scheme type, the document already declares `3.1.0`, and a service mesh terminating client certificates is a real deployment.
- **The types make an invalid scheme unwritable rather than detectable.** `bearerFormat` lives only on the `bearer` arm, so `{ type: 'http', scheme: 'basic', bearerFormat: 'JWT' }` does not compile; an `oauth2` scheme must name at least one flow, so `flows: {}` does not either.
- **`strictSecurity: false` exists and should not be left on.** It does not make the document wrong; it makes it silent — a route with neither guards nor `@Public()` emits no `security` key, and with no top-level default a reader and a client generator both read that as public. It is there so an existing application can generate a document the day it adopts this.

Until then, declaration plus the CI check above is the honest arrangement — and it is close enough to the frozen behaviour that adopting the real thing is mostly deleting the test.

---

See also: [Guards](./web-middleware.html) · [OpenAPI Operations](./web-openapi-operations.html) · [Authentication](./web-authentication.html)
