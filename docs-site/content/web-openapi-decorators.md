> **ToDo / feature gap.** There are no documentation-only decorators such as `@ApiOperation`, `@ApiProperty`, `@ApiResponse`, `@ApiTags`, `@ApiQuery`, or `@ApiBearerAuth`.

## What replaces them

The shared HTTP contract covers executable meaning:

- parameter locations and schemas;
- request body kind, media type, and requiredness;
- exact response statuses, headers, bodies, and media types;
- security schemes and requirements;
- versioning and deprecation; and
- an explicit stable operation ID.

The contract compiler derives schema projections from the same TypeScript types used by runtime validation. There is no field-level `@ApiProperty()` declaration to duplicate:

```ts {"mode":"illustrative","id":"example-001","reason":"This partial declaration omits the containing TypeScript construct described by the surrounding article."}
createPost: httpOperation<CreatePostOperation>({
  controller: PostsController,
  handler: 'create',
  method: 'POST',
  path: '/posts',
  parameters: [],
  requestBody: {
    kind: 'json',
    mediaType: 'application/json',
    required: true,
  },
  responses: {
    201: {
      description: 'Created',
      body: { kind: 'json', mediaType: 'application/json' },
    },
  },
  security: [{ bearerAuth: ['posts:write'] }],
  version: { kind: 'none' },
  deprecated: false,
}),
```

`toOpenApi(compiled.ir)` copies that method-specific contract. Adding or changing a typed field changes the same precomputed schema used by validators and clients.

## Prose metadata

Summaries, descriptions, tags, examples, and external links are not inferred. Add them in a deterministic post-processing pass keyed by the explicit operation ID:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies compiled, toOpenApi; this excerpt does not repeat those declarations."}
const document = toOpenApi(compiled.ir, {
  info: { title: 'Blog API', version: '1.0.0' },
});

const DOCS = {
  listPosts: {
    summary: 'List published posts',
    tags: ['Posts'],
  },
  getPost: {
    summary: 'Fetch one post',
    tags: ['Posts'],
  },
  createPost: {
    summary: 'Create a post',
    tags: ['Posts'],
  },
} as const;

for (const item of Object.values(document.paths)) {
  for (const operation of Object.values(item)) {
    Object.assign(operation, DOCS[operation.operationId]);
  }
}
```

Keying by `operationId` avoids a second controller or route walk. A test can require one metadata entry per contract operation:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies DOCS, compiled, expect, it; this excerpt does not repeat those declarations."}
it('documents every operation', () => {
  for (const operation of compiled.ir.operations) {
    expect(DOCS[operation.operationId]).toBeDefined();
  }
});
```

A missing summary now fails CI. With optional decorators, a missing annotation is otherwise invisible.

## Query parameters and responses

Query, header, cookie, and path parameters are already emitted from `HttpOperationIR.parameters`; exact responses come from `HttpOperationIR.responses`. Do not add those in a prose pass, because that
would create a second executable contract.

## Examples

Examples are documentation rather than validation. Attach synthetic values to the rendered schema or operation:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding article supplies the generated OpenAPI document whose paths are inspected here."}
const operation = document.paths['/posts']?.post;
if (operation === undefined) throw new Error('createPost is missing');

Object.assign(operation, {
  requestBody: {
    ...operation.requestBody,
    description: 'A new post',
  },
});
```

Do not use real customer data in examples. Generated specifications are commonly published.

## What a future decorator may do

A future `@ApiDoc({ summary, tags })` could record prose metadata, but the OpenAPI renderer will remain a pure `HttpContractIR` backend. A build-time collector would have to copy that prose into the
contract or a separate operation-ID-keyed documentation map before rendering. Schema-bearing decorators remain out of scope because they duplicate the typed contract.

---

See also: [OpenAPI Operations](./web-openapi-operations.html) · [OpenAPI schemas](./openapi.html) · [Anti-Patterns](./anti-patterns.html)
