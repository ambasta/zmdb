`@zmdb/web` supports one finite API-version strategy per router: path, request header or the `Accept` media type. The route table is built at registration, and each compiled `HttpOperationIR` carries
the same version decision consumed by routing, OpenAPI, and generated clients.

There is deliberately no precedence rule between strategies because two strategies cannot be configured at once. A request such as `/v1/users` with an `accept-version: 2` header is therefore not an
ambiguous state the framework has to resolve. Mount a second router when migrating between strategies.

## Strategy summary

| Strategy     | Version source                | Missing version       | Unknown version                      | OpenAPI representation                |
| ------------ | ----------------------------- | --------------------- | ------------------------------------ | ------------------------------------- |
| `path`       | expanded public path          | ordinary missing path | `404`, with no route inventory       | one path and operation per version    |
| `header`     | configured request header     | required `default`    | `400`, with route-supported versions | optional enum header on one operation |
| `media-type` | parameter on request `Accept` | required `default`    | `406`, with route-supported versions | one response content key per version  |

Path versioning is the recommendation when a request or response shape changes. Header versioning is for versions that differ only in behaviour. Media-type versioning may vary response shapes, but not
request shapes, because runtime reads `Accept` and never request `Content-Type`.

## Declare versions

```ts
import { httpOperation } from '@zmdb/web/contract';
import { toOpenApi } from '@zmdb/web/openapi';
import { createRouter, type RouteOptions } from '@zmdb/web/pipeline';
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

`@Version` accepts one or more exact strings. There is no ordering, range or "at least version 2": `'1'`, `'1.0'` and `'2026-09-04'` are all legitimate version names, and the framework cannot know
whether semver or date rules apply.

Once a router has a strategy, every route must carry `@Version(...)` or `@VersionNeutral()`. Registration names the controller and handler when neither is present. Conversely, `@Version(...)` on an
unversioned router is an error rather than a decorator that silently does nothing.

`@VersionNeutral()` explicitly says the handler is outside version selection. A method declaration overrides its controller declaration:

```ts
@VersionNeutral()
@Controller('/health')
class HealthController {
  @Get('/')
  check() {
    return { ok: true };
  }

  @Version('2')
  @Get('/details')
  details() {
    return { dependencies: [] };
  }
}
```

Under header and media-type strategies the neutral route answers even when no other route declares the requested version. Under path versioning it keeps its literal path unchanged.

## Path versioning

```ts
const versioning = { kind: 'path', prefix: 'v' } as const;
const router = createRouter({ versioning });
router.register(new UsersController());
```

`@Version('1', '2')` on `/users` registers `/v1/users` and `/v2/users` at startup. Request handling then uses the ordinary method/path table: there is no version extraction or version-table lookup on
the request path.

The final contract declares one operation per expanded path, with its own explicit operation ID and schemas:

```ts
listUsersV1: httpOperation<ListUsersV1>({
  // ...
  path: '/v1/users',
  version: { kind: 'path', value: '1' },
}),
listUsersV2: httpOperation<ListUsersV2>({
  // ...
  path: '/v2/users',
  version: { kind: 'path', value: '2' },
}),

const document = toOpenApi(compiled.ir);
```

Relevant generated fragment:

```json
{
  "paths": {
    "/v1/users": {
      "get": { "operationId": "get_v1_users" }
    },
    "/v2/users": {
      "get": { "operationId": "get_v2_users" }
    }
  }
}
```

A bare `/users` or unknown `/v9/users` is the ordinary uniform `404`; the body does not enumerate which versions or paths exist.

Existing manually prefixed controllers remain valid by declaring that they own their own version:

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
router.register(new UsersController());
```

A missing header selects the required `default`. An unsupported value on a matched route returns `400`:

```json
{ "error": "unsupported version \"9\"", "supported": ["1", "2"] }
```

An unknown path remains the ordinary `404`, even when the header names an unknown version, so unrelated routes do not leak their version inventory.

Header versions share one contract operation and therefore one request/response shape:

```ts
listUsers: httpOperation<ListUsers>({
  // ...
  version: {
    kind: 'header',
    name: 'accept-version',
    values: ['1', '2'],
    default: '1',
  },
});

const document = toOpenApi(compiled.ir);
```

Generated parameter:

```json
{
  "name": "accept-version",
  "in": "header",
  "required": false,
  "style": "simple",
  "explode": false,
  "schema": {
    "type": "string",
    "enum": ["1", "2"],
    "default": "1"
  }
}
```

Contract compilation refuses a default the operation does not serve. Different shapes require separate path-versioned operations because OpenAPI has no operation-schema dimension keyed by a header
value.

## Media-type versioning

```ts
const versioning = {
  kind: 'media-type',
  key: 'version',
  default: '1',
} as const;

const router = createRouter({ versioning });
router.register(new UsersController());
```

The version is read from `Accept`, never request `Content-Type`. Several media ranges are ordered by `q`; `q=0` prohibits that version. If none names a supported acceptable version, runtime returns
`406` with the versions served by that route. A missing version parameter selects `default`.

Request schemas are shared because request `Content-Type` is not the version source. A response may provide one body projection per accepted version:

```ts
listUsers: httpOperation<ListUsers>({
  // ...
  version: {
    kind: 'media-type',
    key: 'version',
    values: ['1', '2'],
    default: '1',
  },
  responses: {
    200: {
      description: 'OK',
      body: { kind: 'json', mediaType: 'application/json' },
      versions: {
        '1': { kind: 'json', mediaType: 'application/json' },
        '2': { kind: 'json', mediaType: 'application/json' },
      },
    },
  },
});

const document = toOpenApi(compiled.ir);
```

Relevant generated fragment:

```json
{
  "requestBody": {
    "content": {
      "application/json": {
        "schema": { "type": "object" }
      }
    }
  },
  "responses": {
    "200": {
      "description": "OK",
      "content": {
        "application/json; version=1": {
          "schema": { "type": "array" }
        },
        "application/json; version=2": {
          "schema": { "type": "object" }
        }
      }
    }
  }
}
```

For a JSON handler response, runtime sets the selected content type too: `application/json; version=2`.

## Deprecating a versioned route

`HttpOperationIR.deprecated: true` emits `deprecated: true`. During decorator migration, `RouteOptions.deprecated` must agree at contract registration. Use separate operations when only one path
version is deprecated:

```ts
@Controller('/users')
class MigratingUsersController {
  @Version('1')
  @Get('/')
  listV1() {
    return [];
  }

  @Version('2')
  @Get('/')
  listV2() {
    return [];
  }
}

const ROUTES = {
  MigratingUsersController: {
    listV1: { deprecated: true },
    listV2: {},
  },
} satisfies Record<string, Record<string, RouteOptions>>;
```

Each path-version operation declares its own `deprecated` value. Header and media-type versions share one contract operation, so they also share security and deprecation.

The marker changes documentation only. It does not emit `Sunset` or `Deprecation` response headers.

## Startup-built resolution

Header and media-type requests select the method/version/segment-count bucket before matching candidate paths. Routes in other versions therefore do not increase candidate reads for the selected
version, and a version-specific route shadows a neutral route at the same method and path regardless of registration order.

The media parser matches known versions through a startup-built trie without `split`, `slice`, lower-casing or substring allocation on the successful known version path. Unsupported-version error
bodies still allocate normally.

OpenAPI cannot represent a neutral and a version-specific handler sharing one method/path as one operation, so contract compilation and rendering refuse that collision. Use distinct public paths when
both handlers must appear in one document.

Custom extractor callbacks are not supported. A callback can produce an application-defined value or preference list with no finite generated document shape; mount a separately configured router
instead.

---

See also: [Controllers & routing](./web-controllers.html) · [Router Module](./web-router-module.html) · [Security Schemes](./web-openapi-security.html) · [OpenAPI Generation](./web-openapi.html)
