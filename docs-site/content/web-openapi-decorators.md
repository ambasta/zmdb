> **ToDo / feature gap.** There are no documentation decorators — no
> `@ApiOperation`, `@ApiProperty`, `@ApiResponse`, `@ApiTags`, `@ApiQuery` or
> `@ApiBearerAuth`. The only decorators in the project are `@Controller`,
> `@Get/@Post/@Put/@Patch/@Delete`, `@Module`, `@Inject`, `@Gateway` and
> `@Subscribe`.

## What replaces them

Two things, and between them they cover most of what decorators are used for.

**Schemas come from the table, not from annotations.** This is the substantive difference. A decorator-based generator needs `@ApiProperty()` on every DTO field, which is the schema written a second time — and it drifts:

```ts
// what a decorator framework needs
class CreatePostDto {
  @ApiProperty({ example: 'Hello', maxLength: 200 })
  title!: string;
  @ApiProperty({ required: false })
  body?: string;
}
```

```ts
// what zmdb needs
schemas: { '/posts': { body: toJsonSchema(posts, 'create') } }
```

The second cannot drift, because it is derived from the same `defineSchema` the queries use. Add a column and the spec updates; make one nullable and the `required` array updates. No annotation to forget. See [OpenAPI Schemas](./openapi.html).

**Prose and metadata go in a post-processing pass.** The document is a plain object:

```ts
const doc = toOpenApi(CONTROLLERS, { info, schemas });

const operation = doc.paths['/posts/{id}']?.get;
if (operation === undefined) throw new Error('route /posts/{id} GET is missing from the document');

Object.assign(operation, {
  operationId: 'posts_byId',
  summary: 'Fetch one post',
  tags: ['Posts'],
});
```

## A maintainable version of that

Editing paths by hand is fragile — a route rename silently orphans the description. Key the metadata off the handler and derive the rest:

```ts
import { getRoutes } from '@zmdb/web/routing';

const DOCS: Record<string, { summary: string; tags: string[] }> = {
  'PostsController.list': { summary: 'List published posts', tags: ['Posts'] },
  'PostsController.byId': { summary: 'Fetch one post', tags: ['Posts'] },
  'PostsController.create': { summary: 'Create a post', tags: ['Posts'] },
};

export function annotate(doc: OpenApiDocument, controllers: readonly ControllerClass[]): void {
  for (const C of controllers) {
    for (const r of getRoutes(C)) {
      const meta = DOCS[`${C.name}.${r.handlerName}`];
      const op = doc.paths[r.path.replace(/:([^/]+)/g, '{$1}')]?.[r.method.toLowerCase()];
      if (op !== undefined) {
        Object.assign(op, { operationId: `${C.name.replace(/Controller$/, '')}_${r.handlerName}`, ...meta });
      }
    }
  }
}
```

Then a test that every route has an entry, which is the thing decorators genuinely give you — locality of enforcement:

```ts
it('every route is documented', () => {
  for (const C of CONTROLLERS) {
    for (const r of getRoutes(C)) expect(DOCS[`${C.name}.${r.handlerName}`]).toBeDefined();
  }
});
```

A missing summary now fails CI. With decorators, a missing `@ApiOperation` is invisible.

## Query parameters

Not generated at all — `toOpenApi` emits path parameters only. Add them in the same pass:

```ts
op.parameters = [
  ...(op.parameters ?? []),
  { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
];
```

Note `OpenApiParameter` as generated is narrowed to `in: 'path'`, so you are augmenting a plain object rather than constructing the library's type. That is fine — the document is `Record<string, unknown>`-shaped at the leaves.

## Examples

`toJsonSchema` does not emit `example` or `examples`. Attach them to the generated schema:

```ts
const body = { ...toJsonSchema(posts, 'create'), examples: [{ title: 'Hello', body: 'World' }] };
```

Do not put real data in an example. Specs get published, and an "example" user with a real email address is a disclosure.

## What it would take

The decorator half is not hard — a `@ApiDoc({ summary, tags, operationId })` method decorator writing to `Symbol.metadata`, read by `toOpenApi` the same way `getRoutes` reads routes. Perhaps fifty lines.

The reason it has not shipped is worth stating: a decorator that only carries prose is a thin win over a keyed record, and a decorator that carries _schema_ information (`@ApiProperty`) would reintroduce exactly the duplicate-declaration problem the schema derivation exists to remove. So if this lands, it lands as prose-and-metadata only, with schemas still coming from `toJsonSchema`.

---

See also: [OpenAPI Operations](./web-openapi-operations.html) · [OpenAPI Schemas](./openapi.html) · [Anti-Patterns](./anti-patterns.html)
