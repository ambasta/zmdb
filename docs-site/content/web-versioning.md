`@zmdb/web` negotiates one exact API version from the path, a request header or
the `Accept` media type. The strategy is selected once when the router is
created, and the same value is passed to OpenAPI generation so runtime and
generated clients describe the same contract.

## Declare versions

```ts
import { toOpenApi, type VersionSchemas } from '@zmdb/web/openapi';
import { createRouter } from '@zmdb/web/pipeline';
import { Controller, Get } from '@zmdb/web/routing';
import { Version, VersionNeutral } from '@zmdb/web/versioning';

@Version('1', '2')
@Controller('/users')
class UsersController {
  @Get('/')
  list() {
    return [];
  }
}
```

`@Version` accepts one or more exact strings. There is no ordering, range or
"at least version 2": `'1'`, `'1.0'` and `'2024-11-05'` are all legitimate
version names, and the framework cannot know whether semver or date rules apply.

Once a router has a strategy, every route must carry `@Version(...)` or
`@VersionNeutral()`. Registration names the controller and handler when neither
is present. `@VersionNeutral()` is the explicit declaration that the same route
serves every version, including versions no other route declares.

A method declaration overrides its controller declaration:

```ts
@VersionNeutral()
@Controller('/health')
class HealthController {
  @Get('/') check() {
    return { ok: true };
  }

  @Version('2')
  @Get('/details')
  details() {
    return { dependencies: [] };
  }
}
```

## Path versioning

```ts
const versioning = { kind: 'path', prefix: 'v' } as const;
const router = createRouter({ versioning });
router.register(new UsersController());
```

`@Version('1', '2')` on `/users` registers `/v1/users` and `/v2/users` at
startup. Request handling then uses the ordinary method/path table; it performs
no version extraction or version-table lookup.

Path versioning is the recommendation when request or response shapes change.
Each version is an independent OpenAPI operation and can carry independent
schemas:

```ts
const document = toOpenApi([UsersController], {
  versioning,
  schemas: {
    '/v1/users': { response: { type: 'array' } },
    '/v2/users': { response: { type: 'object' } },
  },
});
```

The generated operations have distinct path-derived names:

- `GET /v1/users` → `get_v1_users`
- `GET /v2/users` → `get_v2_users`

Existing manually prefixed controllers remain valid under a path strategy by
declaring that they already own their version:

```ts
@VersionNeutral()
@Controller('/v1/users')
class UsersV1 {
  /* ... */
}
```

## Header versioning

```ts
const versioning = {
  kind: 'header',
  name: 'accept-version',
  default: '1',
} as const;

const router = createRouter({ versioning });
```

A missing header selects the required `default`. An unsupported value returns
`400` with the versions that the matched route serves:

```json
{ "error": "unsupported version \"9\"", "supported": ["1", "2"] }
```

An unknown path remains the ordinary uniform `404`; it does not reveal versions
from unrelated routes.

OpenAPI emits one operation with an optional enum header parameter. Header
versions must use identical request and response schemas because one OpenAPI
operation has no schema dimension keyed by a header value:

```ts
const versionSchemas = {
  '/users': {
    '1': { response: { type: 'array' } },
    '2': { response: { type: 'array' } },
  },
} satisfies VersionSchemas;

const document = toOpenApi([UsersController], {
  versioning,
  versionSchemas,
});
```

Generation also requires the configured default to be served by the operation;
otherwise an optional header would describe a request that runtime refuses.

## Media-type versioning

```ts
const versioning = {
  kind: 'media-type',
  key: 'version',
  default: '1',
} as const;

const router = createRouter({ versioning });
```

The version is read from `Accept`, never request `Content-Type`. Several media
ranges are ordered by `q`, and `q=0` prohibits that version. A missing version
parameter selects `default`; an unsupported acceptable version returns `406`
with the route's supported versions.

Request schemas must be identical because request `Content-Type` does not select
a version. Response schemas may differ: OpenAPI emits one response content key
per version, and runtime returns the selected key as the JSON response
`Content-Type`.

```ts
const versionSchemas = {
  '/users': {
    '1': {
      body: { type: 'object' },
      response: { type: 'array' },
    },
    '2': {
      body: { type: 'object' },
      response: { type: 'object' },
    },
  },
} satisfies VersionSchemas;

const document = toOpenApi([UsersController], {
  versioning,
  versionSchemas,
});
```

The resulting response keys are `application/json; version=1` and
`application/json; version=2`.

## Startup-built resolution

Version is a routing-table key, not a guard and not a scan over every registered
route. Header and media-type requests select the method/version/segment-count
bucket before matching candidate paths. Routes in other versions therefore do
not increase candidate reads for the selected version.

The media parser matches a version against a startup-built trie without
`split`, `slice`, lower-casing or substring allocation on the known-version
success path. Unsupported-version error bodies still allocate normally.

Registration order within one version is unchanged. A version-specific route
shadows a neutral route at the same method and path even when the neutral route
was registered first. OpenAPI cannot represent that shadowing as one operation,
so generating a document for a neutral and a specific handler on the same
method/path is an error; use distinct paths when both need to be public.

Custom extractor callbacks are not supported. A callback can return an
application-defined value or preference list that has no finite generated
document shape; mount a separately configured router when migrating between
strategies.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Middleware](./web-middleware.html) · [Security Schemes](./web-openapi-security.html)
