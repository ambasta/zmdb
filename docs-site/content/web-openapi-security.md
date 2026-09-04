`toOpenApi` declares OpenAPI 3.1 security schemes and derives each operation's
`security` requirement from the same guard objects the router runs. A route is
therefore never protected by one declaration and documented by another.

## Declare schemes and guards

```ts
import { toOpenApi, type SecurityAwareGuard, type SecurityScheme } from '@zmdb/web/openapi';
import { createRouter, type GuardRegistry, type RouteOptions } from '@zmdb/web/pipeline';

const SCHEMES = {
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
} as const satisfies Record<string, SecurityScheme>;

const authenticated: SecurityAwareGuard = {
  canActivate: ctx => ctx.headers.authorization !== undefined,
  enforces: { scheme: 'bearerAuth', scopes: [] },
};

const requiresApiKey: SecurityAwareGuard = {
  canActivate: ctx => ctx.headers['x-api-key'] !== undefined,
  enforces: { scheme: 'apiKey', scopes: [] },
};

const requiresWrite: SecurityAwareGuard = {
  canActivate: ctx => ctx.headers.authorization?.includes('users:write') === true,
  enforces: { scheme: 'bearerAuth', scopes: ['users:write'] },
};

const GUARD_REGISTRY = {
  app: [authenticated],
  controllers: { UsersController: [requiresApiKey] },
} as const satisfies GuardRegistry;

const ROUTES = {
  UsersController: {
    create: { guards: [requiresWrite] },
  },
} as const satisfies Record<string, Record<string, RouteOptions>>;
```

Pass the same registry and per-handler records to the router and document
generator:

```ts
const router = createRouter({ guardRegistry: GUARD_REGISTRY });
router.register(new UsersController(), ROUTES.UsersController);

const document = toOpenApi([UsersController], {
  info: { title: 'Users', version: '1.0.0' },
  securitySchemes: SCHEMES,
  guardRegistry: GUARD_REGISTRY,
  routes: ROUTES,
});
```

`register` takes a controller **instance**. `toOpenApi` accepts classes or
instances, but the `routes` map is always keyed by class name and then handler
name. `guardRegistry.controllers` uses the same class-name key. Effective guards
run in app → controller → route order, and OpenAPI derives from that whole chain.

## Mark intentionally public routes

Strict generation is on by default once `routes` or `guardRegistry` is supplied.
Every route must have effective guards or an explicit public marker:

```ts
import { Controller, Post, Public } from '@zmdb/web/routing';

@Controller('/auth')
class AuthController {
  @Public()
  @Post('/login')
  login() {
    // ...
  }
}
```

`@Public()` emits `security: []`. That is a positive statement that the operation
needs no authentication, not an omitted field. At runtime it bypasses inherited
app/controller guards; declaring a route guard or non-empty explicit security
requirement on the same handler is an error.
It is also directly auditable:

```bash
rg '@Public\\(' packages
```

`isPublic(ControllerClass, handlerName)` reads the same Stage-3 metadata when an
application needs a programmatic audit.

## Build-time failures

`toOpenApi` locates the controller and handler and refuses to generate when:

- a route has no effective guards and no `@Public()`;
- an `@Public()` route also declares route guards or a non-empty override;
- a guard lacks `enforces` and there is no explicit security override;
- a guard or override names an undeclared scheme;
- an override omits a scheme or scope derived from a guard.

The diagnostic tells the caller to add a guard, declare `enforces` (or provide
`RouteOptions.security` for a legacy guard), declare referenced schemes, or mark
the handler `@Public()`.

An existing application can migrate with `strictSecurity: false`. An undeclared
route then has no `security` key; it is silent, not explicitly public. Do not
leave this disabled after every route has been classified.

Strictness applies when a `routes` record or `guardRegistry` is supplied.
Existing calls that pass only `info` and `schemas` retain their previous document
byte-for-byte.

## Legacy guards and infrastructure enforcement

A third-party guard may have no `enforces` property. State the requirement
explicitly on that handler:

```ts
const ROUTES = {
  AdminController: {
    list: {
      guards: [legacyGuard],
      security: [{ bearerAuth: [], mesh: [] }],
    },
  },
} satisfies Record<string, Record<string, RouteOptions>>;
```

An explicit requirement may add protection the framework cannot see, such as
mutual TLS terminated by a service mesh. It may not remove anything declared by
the route's effective app, controller or route guards.

## How several guards map to OpenAPI

The router requires every effective guard to pass. OpenAPI represents that AND
by putting every scheme in one requirement object:

```ts
const guardRegistry = {
  app: [authenticated],
  controllers: { UsersController: [requiresApiKey] },
};
const routes = { UsersController: { create: { guards: [requiresWrite] } } };
// security: [{ bearerAuth: ['users:write'], apiKey: [] }]
```

Two guards naming the same scheme produce one entry. Their scopes are merged,
deduplicated and sorted:

```ts
// security: [{ oauth2: ['posts:read', 'posts:write'] }]
```

Scopes describe what `canActivate` enforces; the framework does not independently
interpret a token's scopes.

## Supported scheme types

The exported `SecurityScheme` union covers OpenAPI 3.1 HTTP basic and bearer,
API keys in headers/query/cookies, mutual TLS, OpenID Connect, and OAuth2
implicit, password, client-credentials and authorization-code flows.

OAuth2 requires at least one flow and each flow requires a `scopes` object.
`bearerFormat` exists only on the bearer arm, so meaningless combinations such as
basic authentication with `bearerFormat: 'JWT'` do not compile.

Never place a real key, token or client secret in `securitySchemes`. The document
describes where credentials travel; it does not contain credentials.

## Document shape

Declared schemes appear under `components.securitySchemes`. Every classified
operation carries its own `security`; no document-level default is emitted.
That keeps "forgotten" distinguishable from "inherits a default" during review.

`packages/web/src/openapi/security.spec.ts` validates representative generated
documents against the OpenAPI 3.1 schema in addition to checking the exact
derived requirements.

---

See also: [Guards](./web-middleware.html) · [OpenAPI Operations](./web-openapi-operations.html) · [Authentication](./web-authentication.html)
