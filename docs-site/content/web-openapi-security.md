The security requirement on every generated operation comes from the **same guard instances the router executes**. There is no second hand-written OpenAPI declaration to keep in step: app, controller
and route guards are resolved into one effective chain, and `toOpenApi` derives its schemes and scopes from the same guard objects.

The explicit `RouteOptions.security` escape hatch is reserved for a legacy guard that cannot declare itself or protection outside the process, such as mutual TLS terminated by a service mesh. It is
checked against every declaration the framework can see and may only add protection, never remove it.

## Declare every OpenAPI 3.1 scheme

```ts
import { toOpenApi, type SecurityAwareGuard, type SecurityScheme } from '@zmdb/web/openapi';
import { createRouter, type GuardRegistry, type RouteOptions } from '@zmdb/web/pipeline';
import { Controller, Get, Post, Public } from '@zmdb/web/routing';

const SCHEMES = {
  basicAuth: { type: 'http', scheme: 'basic' },
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },

  headerKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
  queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
  cookieKey: { type: 'apiKey', in: 'cookie', name: 'session' },

  mesh: { type: 'mutualTLS' },

  oauth2: {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://id.example.com/oauth/authorize',
        tokenUrl: 'https://id.example.com/oauth/token',
        refreshUrl: 'https://id.example.com/oauth/refresh',
        scopes: {
          'users:read': 'Read users',
          'users:write': 'Create and change users',
        },
      },
    },
  },

  oidc: {
    type: 'openIdConnect',
    openIdConnectUrl: 'https://id.example.com/.well-known/openid-configuration',
  },
} as const satisfies Record<string, SecurityScheme>;
```

`SecurityScheme` covers all five OpenAPI 3.1 scheme types. The `http` type is split into basic and bearer so `bearerFormat` cannot be attached to basic authentication. API keys may travel in a header,
query parameter or cookie.

OAuth2 requires at least one flow and every flow has a `scopes` object:

| Flow                | Required URL fields               |
| ------------------- | --------------------------------- |
| `implicit`          | `authorizationUrl`                |
| `password`          | `tokenUrl`                        |
| `clientCredentials` | `tokenUrl`                        |
| `authorizationCode` | `authorizationUrl` and `tokenUrl` |

`refreshUrl` is optional on every flow. The framework emits these declarations unchanged under `components.securitySchemes`; it does not fetch the OpenID configuration or run an OAuth exchange.

Never put a real key, token or client secret in this record. It describes where credentials travel and how clients obtain them; it does not contain credentials.

## Declare guards once

```ts
const authenticated: SecurityAwareGuard = {
  canActivate: ctx => ctx.headers.authorization !== undefined,
  enforces: { scheme: 'bearerAuth', scopes: [] },
};

const requiresApiKey: SecurityAwareGuard = {
  canActivate: ctx => ctx.headers['x-api-key'] !== undefined,
  enforces: { scheme: 'headerKey', scopes: [] },
};

const requiresWrite: SecurityAwareGuard = {
  canActivate: ctx => ctx.headers.authorization?.includes('users:write') === true,
  enforces: { scheme: 'bearerAuth', scopes: ['users:write'] },
};

@Controller('/users')
class UsersController {
  @Post('/')
  create() {
    return {};
  }

  @Public()
  @Get('/status')
  status() {
    return { ok: true };
  }
}

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

Pass those exact objects to runtime routing and document generation:

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

The declarations round-trip unchanged into the generated document:

```json
{
  "components": {
    "securitySchemes": {
      "basicAuth": {
        "type": "http",
        "scheme": "basic"
      },
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      },
      "headerKey": {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key"
      },
      "queryKey": {
        "type": "apiKey",
        "in": "query",
        "name": "api_key"
      },
      "cookieKey": {
        "type": "apiKey",
        "in": "cookie",
        "name": "session"
      },
      "mesh": {
        "type": "mutualTLS"
      },
      "oauth2": {
        "type": "oauth2",
        "flows": {
          "authorizationCode": {
            "authorizationUrl": "https://id.example.com/oauth/authorize",
            "tokenUrl": "https://id.example.com/oauth/token",
            "refreshUrl": "https://id.example.com/oauth/refresh",
            "scopes": {
              "users:read": "Read users",
              "users:write": "Create and change users"
            }
          }
        }
      },
      "oidc": {
        "type": "openIdConnect",
        "openIdConnectUrl": "https://id.example.com/.well-known/openid-configuration"
      }
    }
  }
}
```

`register` takes a controller **instance**. `toOpenApi` accepts classes or instances, while `routes` and `guardRegistry.controllers` are keyed by class name and then handler name.

The guarded operation is derived from all three guard levels. Two guards naming `bearerAuth` merge into one entry and their scopes are deduplicated and sorted:

```json
{
  "paths": {
    "/users": {
      "post": {
        "security": [
          {
            "bearerAuth": ["users:write"],
            "headerKey": []
          }
        ]
      }
    },
    "/users/status": {
      "get": {
        "security": []
      }
    }
  }
}
```

Several schemes in one requirement object mean **all are required** in OpenAPI. That matches runtime: app → controller → route guards all have to pass. The framework never emits one requirement object
per guard, because that spelling would mean any one scheme is enough.

`enforces.scopes` documents what `canActivate` checks. The framework does not parse a token or enforce those scopes independently; a guard whose implementation disagrees with its declaration is still
a bug in that guard.

## `@Public()` is an auditable opt-out

`@Public()` is a positive, greppable declaration that a handler needs no authentication. It emits `security: []` rather than omitting the key, and at runtime it bypasses inherited app and controller
guards.

From an application root, list every public endpoint:

```bash
rg -n '^\s*@Public\(\)' src --glob '*.ts'
```

The generated-document audit is the same list in machine-readable form: every such operation has `security: []`. `isPublic(ControllerClass, handlerName)` reads the same Stage-3 metadata for a
programmatic source audit.

An `@Public()` handler cannot also declare a route guard or a non-empty explicit security requirement. That is rejected instead of creating an ambiguous override.

## Strict generation fails closed

Strict generation activates by default when `routes` or `guardRegistry` is supplied. `toOpenApi` names the controller and handler and refuses to generate when:

- a route has no effective guards and no `@Public()`;
- an `@Public()` route also declares route guards or a non-empty override;
- a guard lacks `enforces` and there is no explicit security override;
- a guard or override names a scheme absent from `securitySchemes`;
- an override omits a scheme or scope derived from an effective guard.

The error tells the caller to add a guard, declare `enforces`, provide a legacy override, declare the referenced scheme, or mark the route `@Public()`.

An existing application can migrate with `strictSecurity: false`. An unclassified operation then has no `security` key at all: it is silent, not explicitly public. Leave this disabled only while
classifying an existing route set.

Calls that supply only `info` and `schemas` retain the pre-security document shape; strictness is not activated until the guard/route configuration is present.

## Legacy guards and infrastructure enforcement

A third-party guard may implement `canActivate` but have no `enforces` property. State its requirement on that handler:

```ts
const LEGACY_ROUTES = {
  AdminController: {
    list: {
      guards: [legacyGuard],
      security: [{ bearerAuth: [], mesh: [] }],
    },
  },
} satisfies Record<string, Record<string, RouteOptions>>;
```

Both `bearerAuth` and `mesh` are declared in `SCHEMES` above. The explicit requirement may add protection the process cannot inspect, such as the mesh's client certificate, but it must remain a
superset of everything the declaring guards enforce.

## Document shape

Schemes live under `components.securitySchemes`. Every classified operation carries its own `security`; `toOpenApi` emits no document-level default. That keeps "forgotten" distinguishable from
"inherits a default" during review.

`packages/web/src/openapi/security.spec.ts` validates representative generated documents against the OpenAPI 3.1 schema as well as checking exact derived requirements.

---

See also: [Guards](./web-middleware.html) · [OpenAPI Generation](./web-openapi.html) · [OpenAPI Operations](./web-openapi-operations.html) · [Authentication](./web-authentication.html)
