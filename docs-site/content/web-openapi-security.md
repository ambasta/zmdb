> **ToDo / feature gap.** `OpenApiOptions` has two fields, `info` and `schemas`.
> There is no `securitySchemes`, no `security`, and no `@ApiBearerAuth`
> equivalent — the generated `OpenApiDocument` has no `components` section at all.

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

Small, and mostly a decision about shape. `OpenApiOptions` would gain `securitySchemes` and a default `security`, and `RouteSchemas` would gain a per-route `security` — at which point the exception list above becomes part of the call rather than a post-processing pass. The generated `OpenApiDocument` type would need a `components` field, which is a type change on a public interface.

The larger question is whether route-level security should be derived from a guard rather than declared twice. That would need guards to be registered on routes, which they are not today — see [Request Lifecycle](./web-request-lifecycle.html). Until then, declaration plus the CI check is the honest arrangement.

---

See also: [Guards](./web-middleware.html) · [OpenAPI Operations](./web-openapi-operations.html) · [Authentication](./web-authentication.html)
