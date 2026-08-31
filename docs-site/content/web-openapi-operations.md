`toOpenApi(controllers, options)` produces an OpenAPI 3.1 document from your route metadata. This page is about what an operation object contains, and what it does not.

## What is generated

```ts
import { toOpenApi } from '@zmdb/web/openapi';

const doc = toOpenApi([PostsController, UsersController], {
  info: { title: 'Blog API', version: '1.0.0' },
});
```

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Blog API", "version": "1.0.0" },
  "paths": {
    "/posts": { "get": { "responses": { "200": { "description": "OK" } } } },
    "/posts/{id}": {
      "get": {
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "OK" } }
      }
    }
  }
}
```

Three things happen automatically: `:id` becomes `{id}`, path parameters are declared as required strings, and paths and methods are emitted in sorted order so the document is byte-stable across runs. That last property is what lets you commit the spec and diff it in review — a spec that reorders itself is a spec nobody reads.

## Adding schemas

`options.schemas` is keyed by the **route path**, not the handler name:

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';

const doc = toOpenApi([PostsController], {
  info: { title: 'Blog API', version: '1.0.0' },
  schemas: {
    '/posts': {
      body: toJsonSchema(posts, 'create'),
      response: toJsonSchema(posts, 'entity'),
    },
    '/posts/{id}': { response: toJsonSchema(posts, 'get') },
  },
});
```

> [!WARNING]
> The key must be the **zmdb** route path — `/posts/:id`, not `/posts/{id}` —
> because lookup happens before the path is converted. A `{id}` key silently
> matches nothing, and you get an operation with no schema and no error.

`RouteSchemas` has exactly two fields, `body` and `response`, and both are plain `JsonSchema`. The schema variants (`entity | create | update | get | list | search`) come from `@zmdb/schema-core/openapi` and are derived from your table, so a new column appears in the spec with no edit. See [OpenAPI Schemas](./openapi.html).

## Two operations on one path

A path with several methods shares one path item, so give each method its own entry — but note that `schemas` is keyed by path alone:

```ts
schemas: { '/posts': { body: toJsonSchema(posts, 'create') } }
```

That body schema attaches to **every** method on `/posts`, including the `GET`. There is no per-method schema key. If your `GET /posts` and `POST /posts` need different documents, the honest options are to split the path or to post-process the returned document:

```ts
const doc = toOpenApi([PostsController], options);
delete doc.paths['/posts']?.get?.requestBody;
```

The document is a plain object, so editing it is legitimate and is the escape hatch for everything below.

## What an operation does not have

|                          |                                                     |
| ------------------------ | --------------------------------------------------- |
| `summary`, `description` | not generated                                       |
| `operationId`            | not generated                                       |
| `tags`                   | not generated                                       |
| Non-200 responses        | only `200: OK`                                      |
| Query parameters         | not generated                                       |
| Header parameters        | not generated                                       |
| `components` / `$ref`    | schemas are inlined                                 |
| `deprecated`             | not generated                                       |
| Security                 | see [OpenAPI Security](./web-openapi-security.html) |

`operationId` and `tags` are the two that matter most in practice, because client generators use them for method and class names. Without them, a generated client has names derived from paths.

Both are addable in a post-processing pass, and doing it from the same metadata keeps it in sync:

```ts
import { getRoutes } from '@zmdb/web/routing';

const doc = toOpenApi(CONTROLLERS, { info });

for (const C of CONTROLLERS) {
  const tag = C.name.replace(/Controller$/, '');
  for (const r of getRoutes(C)) {
    const openapiPath = r.path.replace(/:([^/]+)/g, '{$1}');
    const op = doc.paths[openapiPath]?.[r.method.toLowerCase()];
    if (op !== undefined) Object.assign(op, { operationId: `${tag}_${r.handlerName}`, tags: [tag] });
  }
}
```

Twenty lines, derived from the same source of truth as the routes, and it survives a rename. This is what the decorators on [OpenAPI Decorators](./web-openapi-decorators.html) would automate.

## The `200`-only responses reflect reality

The [request lifecycle](./web-request-lifecycle.html) can only produce 200 (handler returned), 400 (threw something with `issues`), 404 (no route matched) and 500 (threw anything else) — and a handler cannot choose. So a document declaring `201` or `404` per operation would be documenting behaviour the framework does not have.

If you add the status-mapping wrapper described in [Request Lifecycle](./web-request-lifecycle.html), add the matching responses in the same post-processing pass.

## Serving it

```ts
import { serveOpenApi } from '@zmdb/web/openapi';

@Controller('/openapi.json')
export class SpecController {
  readonly #doc = serveOpenApi(doc);

  @Get()
  spec() {
    return this.#doc();
  }
}
```

`serveOpenApi(doc)` returns `() => doc` — a prebuilt document, so nothing is regenerated per request.

Build the document once at startup, not per request. And consider committing it and diffing in CI: a spec change that nobody intended is an API break, and this is the cheapest place to catch one.

## Instances or classes

`toOpenApi` accepts either — it normalises an instance to its constructor to read the metadata. So you can pass the same array you gave `@Module({ controllers })`.

---

See also: [OpenAPI Generation](./openapi.html) · [OpenAPI Schemas](./openapi.html) · [OpenAPI Decorators](./web-openapi-decorators.html)
