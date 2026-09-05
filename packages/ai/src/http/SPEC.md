# SPEC — tools from an OpenAPI document (frozen)

Part of `@zmdb/ai`, exported from `@zmdb/ai/http`. A build-time generator turns an OpenAPI document into provider-neutral tool specs, argument types, validators, and request plans. A caller-owned,
allowlisted `fetch` policy binds those generated plans to HTTP handlers.

`../SPEC.md` owns the tool document and provider framings. This file owns only OpenAPI mapping, deterministic generation, and the bounded HTTP caller.

## 4. Tools from an OpenAPI document: what maps, and what is not there to map

```ts
export interface OpenApiToolsOptions {
  readonly provider?: ToolProvider; // default 'json-schema'
  readonly include?: (op: { readonly method: string; readonly path: string; readonly operationId: string }) => boolean;
}
export declare function toolsFromOpenApi(doc: unknown, opts?: OpenApiToolsOptions): readonly ToolSpec[];
export declare function generateOpenApiToolsModule(doc: unknown, opts?: OpenApiToolsOptions): string;

export interface OpenApiGeneratedTool<T> {
  readonly spec: ToolSpec;
  readonly request: {
    readonly method: string;
    readonly path: string;
    readonly pathParameters: readonly string[];
    readonly queryParameters: readonly string[];
    readonly bodyParameters: readonly string[];
    readonly hasBody: boolean;
  };
  readonly validate: (input: unknown) => T;
}

export interface OpenApiCallerOptions {
  readonly baseUrl: string;
  readonly allowedBaseUrls: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface BoundOpenApiTool<T> {
  readonly spec: ToolSpec;
  readonly validate: (input: unknown) => T;
  readonly handler: (input: T) => Promise<unknown>;
}

export declare function bindOpenApiTool<T>(tool: OpenApiGeneratedTool<T>, options: OpenApiCallerOptions): BoundOpenApiTool<T>;
```

The mapping, and the part the issue's step 8 asks for:

| Document construct                  | Tool parameter                                              |
| ----------------------------------- | ----------------------------------------------------------- |
| `in: 'path'` parameter              | a required property, `type` from its schema, name unchanged |
| `in: 'query'` parameter             | a property, required iff the parameter is                   |
| `in: 'header'` parameter            | **dropped** — see below                                     |
| `in: 'cookie'` parameter            | **dropped** — same reason                                   |
| `requestBody`, `application/json`   | its properties, flattened into the same object              |
| `requestBody`, any other media type | the operation is refused                                    |
| `operationId`                       | the tool name, after the provider's name rule               |
| `summary` / `description`           | the tool description, `summary` preferred                   |

**Headers and cookies are dropped rather than exposed, and that is a security decision, not a simplification.** A header parameter is where `Authorization`, `Cookie`, `X-Api-Key` and every tenant
header live. A tool parameter is a field a language model fills in from text it was given, some of which may be attacker-supplied. Letting a model choose a header value is letting it choose who the
request is authenticated as.

So headers come from the caller's `fetch` wrapper, one place, per generated call, and the model cannot see or set them — `llm-mcp.md`'s "authorise the caller, not the request", in the one place where
a document would otherwise hand the model the mechanism.

Path arguments must compile to one URL scalar. Query arguments may be scalars or arrays of scalars, which become repeated `URLSearchParams` entries. Object-valued URL parameters are refused during
generation rather than reaching a caller that cannot serialize them without inventing a convention.

**Flattening the body into the same object** is chosen because a tool document is one level deep for zmdb's own schemas (`../SPEC.md` §1) and a nested `body` object would be the only nesting in the
system, reachable only by this path. A name collision between a parameter and a body property refuses the operation rather than resolving it, since either resolution silently sends the model's value
to the wrong place.

Refusals, each naming the operation:

- no `operationId`,
- a name the target provider's pattern rejects — the same table `../SPEC.md` §2.1 freezes, which is where a 64-character limit and a `[A-Za-z0-9_-]` rule live,
- two operations that produce the same tool name,
- a body that is not `application/json`,
- a parameter or body schema containing a construct the target provider cannot express — `$ref` that does not resolve within the document, `oneOf`/`anyOf` for `gemini`, and everything else §2.1's
  table lists. This is the one place those provider limits are reachable at all: a third-party document has nesting, unions and recursion that a zmdb schema cannot produce.

`$ref` within the document is resolved by inlining, with a cycle detected and refused. A `$ref` to another file or a URL is refused without fetching it — a generator that dereferences a URL is a
generator that makes a network call at build time against a document that may be hostile.

## 5. `operationId`, and the round trip through zmdb's own document

Step 9 asks that zmdb's own generated document round-trip into tools that match the shared HTTP contract. `toOpenApi` copies the explicit `HttpOperationIR.operationId`; it does not derive another name
from a controller or route. It refuses duplicate operation IDs and duplicate final method/path pairs instead of silently overwriting one operation. `toolsFromOpenApi` therefore requires the field and
refuses a third-party document that omits it, naming the method and path. It never invents a fallback name from a document it does not own.

The generated document carries every parameter location, exact status, security requirement and version from `HttpContractIR`. Request and response schemas come from each operation's referenced
`HttpTypeIR.openApi` projection, so `GET /users` and `POST /users` can share one public path without sharing a request body.

Every contract operation becomes exactly one tool. Path parameters stay required strings, query parameters retain their schemas, headers and cookies remain deliberately excluded from model input, and
body properties appear exactly when that operation declares a JSON request body.

Path parameters being strings is not a mismatch to repair: the shared wire contract declares their schema before routing, OpenAPI or tool generation sees them. The round trip recovers the wire
document, not a lost application type such as `Date`.

## 6. Build time, and what is _not_ generated

Step 8 says build time is the right answer for the cost model, and it is — for the documents. Parsing an OpenAPI document, resolving its `$ref`s and framing every operation is work whose result
changes only when the document does, so it happens once in a script that writes a module, the way `migrations-web-mobile.md` already generates client migrations. A process that does it at boot pays
for it on every deploy, every worker and every lambda cold start.

The generated module contains TypeScript argument types, provider-neutral tool specs, request plans and one ordinary `assert<T>` validator per operation:

```ts
// generated by @zmdb/ai/http — do not edit
export type SearchDocsArguments = {
  readonly q: string & MinLength<1>;
};
export const searchDocsTool: OpenApiGeneratedTool<SearchDocsArguments> = {
  spec: { name: 'search_docs', parameters: { … } },
  request: { method: 'GET', path: '/search', pathParameters: [], queryParameters: ['q'], … },
  validate: (input: unknown): SearchDocsArguments => assert<SearchDocsArguments>(input),
};
```

That is not a JSON-Schema validator implementation. The existing AOT transform reads the generated TypeScript type into the same `TypeIR` as every handwritten `assert<T>` and emits the validator. The
checked-in fixture is run through the real transform in the round-trip suite, which also catches a stale generated module.

`bindOpenApiTool` validates the configured base URL once against an exact caller-owned allowlist. Only the validated argument object reaches URL construction: path values are percent-encoded, query
values go through `URLSearchParams`, and body fields are selected from the generated request plan. Credentials and tenant headers remain caller-owned. Static and parameter-supplied `.` / `..` URL
segments are refused before `URL` resolution can normalize them outside the intended path. Responses have a default 1 MiB bound and requests a default 60-second timeout.

## 7. What #535 has to assert

1. `toolsFromOpenApi` over a fixture document covers every row of §4's table, including that a header parameter does not appear in any tool's properties.
2. Each refusal in §4, by operation name: missing name, provider-rejected name, duplicate name, non-JSON body, unresolvable `$ref`, `$ref` cycle, external `$ref`, parameter/body name collision.
3. The round trip of §5 against `toOpenApi(httpContractIR)` for the existing generated-schema fixture — tools are compared to the explicit IR operations, including two methods on one path, so no
   controller or path-keyed schema collector can reappear.
4. The generated module is deterministic, is already formatter-clean, is checked in, and its `assert<T>` calls are compiled by the existing AOT emitter.
5. The caller refuses a base URL outside the exact allowlist and constructs the path, query and JSON body only from the validated argument object. Its `fetch` is injected, so no test makes a network
   call.

## 8. Non-goals (rejected)

- **No provider abstraction, model registry, fallback or cost table.**
- **No `process.env` access.** Credentials are caller-owned headers and never model-controlled arguments.
- **No retries or streaming policy.** The caller owns transport policy around the injected `fetch`.
- **No header or cookie parameters in a generated tool.** §4 — a model choosing a header value is a model choosing an identity.
- **No nested `body` object in a generated tool.** §4 — it would be the only nesting in the system.
- **No `$ref` fetching, and no cyclic `$ref` support.** §4.
- **No second validator front end.** §6 — generated `assert<T>` calls go through the existing TypeScript reflector and `TypeIR` emitter.
- **No boot-time generation in the documented path.** §6 — `generateOpenApiToolsModule` belongs in a build script and its checked-in output is what the application imports.
