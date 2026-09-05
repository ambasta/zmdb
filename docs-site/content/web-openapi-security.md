OpenAPI security is part of the shared HTTP contract. The declaration, runtime router, OpenAPI renderer, and generated client all consume the same `HttpOperationIR.security`; the renderer does not
reconstruct requirements from controllers or guards.

## Declare schemes and requirements

```ts
import { defineHttpContract, httpOperation, type SecurityScheme } from '@zmdb/web/contract';

const SCHEMES = {
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  headerKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
  mesh: { type: 'mutualTLS' },
  oauth2: {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://id.example.com/oauth/authorize',
        tokenUrl: 'https://id.example.com/oauth/token',
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

export const HTTP_CONTRACT = defineHttpContract({
  securitySchemes: SCHEMES,
  operations: {
    createUser: httpOperation<CreateUserOperation>({
      controller: UsersController,
      handler: 'create',
      method: 'POST',
      path: '/users',
      parameters: [],
      requestBody: { kind: 'json', mediaType: 'application/json', required: true },
      responses: {
        201: { description: 'Created', body: { kind: 'json', mediaType: 'application/json' } },
      },
      security: [{ bearerAuth: ['users:write'], headerKey: [] }],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});
```

One requirement object means every named scheme is required. Several requirement objects mean alternatives:

```ts
security: [{ bearerAuth: ['users:write'] }, { headerKey: [] }];
```

An empty array means explicitly public:

```ts
security: [];
```

## Scheme vocabulary

`SecurityScheme` covers every OpenAPI 3.1 scheme type:

- HTTP basic and bearer;
- API keys in headers, query parameters, or cookies;
- mutual TLS;
- OAuth2 implicit, password, client-credentials, and authorization-code flows; and
- OpenID Connect.

The HTTP union keeps basic and bearer separate, so `bearerFormat` cannot be attached to basic authentication. OAuth2 requires at least one flow and every flow has a `scopes` map. `refreshUrl` is
optional.

Never place a token, password, key, certificate, or client secret in the scheme record. It describes how credentials travel; credentials are supplied at runtime.

## Runtime agreement

Register the compiled contract with the same route options and guards the application runs:

```ts
const compiled = compileHttpContracts(sources, { session });
const router = createRouter({ guardRegistry: GUARD_REGISTRY });

router.registerContract(compiled, [new UsersController()], ROUTES);
```

`registerContract` refuses startup when:

- `@Public()` disagrees with an empty/non-empty contract requirement;
- a protected operation has no runtime guard;
- the effective guard requirement differs from the contract; or
- `RouteOptions.deprecated` differs from the operation.

Security-aware guards still declare `{ scheme, scopes }`, and several guards on one route merge into one AND requirement. A legacy guard may use `RouteOptions.security`, but that value must equal the
contract operation. The comparison happens at registration; OpenAPI simply emits the already-verified contract.

## Generated document

Schemes appear under `components.securitySchemes`. Every operation has its own `security`, including public operations:

```json
{
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      }
    }
  },
  "paths": {
    "/users": {
      "post": {
        "security": [{ "bearerAuth": ["users:write"] }]
      }
    },
    "/status": {
      "get": {
        "security": []
      }
    }
  }
}
```

There is no document-level default. A reviewer can read each operation without resolving inheritance, and a missing or undeclared scheme is a generation error.

## `@Public()` remains auditable

`@Public()` is the runtime marker for an unauthenticated handler. Contract compilation requires the matching operation to declare `security: []`, and contract registration checks the same decision.

From an application root:

```bash
rg -n '^\s*@Public\(\)' src --glob '*.ts'
```

The generated-document audit is the set of operations carrying `security: []`.

---

See also: [Generated client authentication](./generated-client.html#4-use-the-generated-client) · [Guards](./web-middleware.html) · [OpenAPI Generation](./web-openapi.html) ·
[OpenAPI Operations](./web-openapi-operations.html) · [Authentication](./web-authentication.html)
