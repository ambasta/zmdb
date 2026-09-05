# `@zmdb/web/contract` — shared HTTP contract SPEC

> Issue #679, parent #678. Frozen before tests or implementation. This is the build-time source shared by routing, OpenAPI, and generated clients. It does not describe a second router or a second
> schema front-end.

## 1. Measured baseline at `94164c53`

The target below records a migration from this historical baseline. These bullets describe commit `94164c53`, not the current tree:

- `ResolvedRoute` contains only `method`, `path`, and `handlerName`; `getRoutes` reads those values from Stage-3 decorator metadata.
- `RouteSchemas` contains only `body?` and `response?`, and `OpenApiOptions.schemas` is keyed by path rather than by method plus path.
- A focused probe with `GET /users` and `POST /users` showed one `schemas['/users']` entry attaching the same request body and response schema to both operations.
- The same probe showed both operations exposing only status `200`, a Fetch request for `/users?tag=a&tag=b` reaching its handler with `ctx.query === {}`, and no `signal` property on `Ctx`.
- `toOpenApi` called `getRoutes`, `versionsOf`, `isPublic`, and guard resolution directly. OpenAPI was therefore a route collector rather than a pure emitter.
- `@zmdb/aot-validator` recognised 17 generic callees. Its `ReflectSession` was the one compiler session and `TypeIR` was the serialisable schema representation.
- The repository had six package directories and no `packages/client`, `@zmdb/client` manifest reference, or lockfile entry.

These facts define the migration starting point. They are not retained as compatibility constraints.

## 2. Ownership and dependency direction

The final ownership is:

| Owner                         | Responsibility                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@zmdb/web/contract`          | Public declaration helpers, `HttpContractIR`, wire metadata, deterministic normalisation, and contract diagnostics               |
| `@zmdb/web/contract/compiler` | Build-time collection of declared operations through one `ReflectSession`, plus conversion of reflected `TypeIR` into HTTP plans |
| `@zmdb/aot-validator/reflect` | The only TypeScript type front-end: TypeScript `Type` to `TypeIR`                                                                |
| `@zmdb/aot-validator/emit`    | Precomputed request decoders, response validators, and wire codecs generated from `TypeIR`                                       |
| `@zmdb/web` routing           | Binding compiled operations to controller methods and dispatching them                                                           |
| `@zmdb/web/openapi`           | A pure `HttpContractIR` to OpenAPI 3.1 emitter                                                                                   |
| `@zmdb/client`                | Dependency-free transport, request execution, body limits, cancellation, authentication injection, and stable error classes      |
| generated application module  | Operation-specific input/output types and precomputed request/response plans; imports only `@zmdb/client` at runtime             |
| `zmdb`                        | Curated product re-exports; no contract collection, reflection, generation, or transport implementation                          |

The dependency direction is acyclic:

```text
@zmdb/schema-core/ir
          │
          ├──────────────> @zmdb/aot-validator/{reflect,emit}
          │                                  │
          └──────────────> @zmdb/web/contract/compiler
                                             │
                                             ▼
                                  emitted HttpContractIR
                                    │                │
                                    ▼                ▼
                             @zmdb/web runtime   OpenAPI/client generator
                                                       │
                                                       ▼
                                                generated module
                                                       │
                                                       ▼
                                                @zmdb/client
```

`@zmdb/aot-validator` does not import `@zmdb/web`, even as a type-only edge. The web compiler calls the existing public reflect and emit back-ends. The runtime `@zmdb/web/contract` entry does not
reach TypeScript, the compiler session, the filesystem, or the build-time compiler subpath.

## 3. One explicit declaration

The authoritative source is an explicit contract module. It contains route identity and wire metadata as values, and request/response application types as generic arguments:

```ts
import { defineHttpContract, httpOperation } from '@zmdb/web/contract';

interface GetUser {
  readonly path: { readonly id: string };
  readonly query: { readonly expand?: readonly string[] };
  readonly headers: { readonly requestId?: string };
  readonly cookies: { readonly session: string };
  readonly responses: {
    readonly 200: { readonly body: User };
    readonly 404: { readonly body: NotFound };
  };
}

export const httpContract = defineHttpContract({
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
  },
  operations: {
    get_users_id: httpOperation<GetUser>({
      controller: UsersController,
      handler: 'get',
      method: 'GET',
      path: '/users/:id',
      parameters: [
        { in: 'path', property: 'id', name: 'id' },
        { in: 'query', property: 'expand', name: 'expand' },
        { in: 'header', property: 'requestId', name: 'x-request-id' },
        { in: 'cookie', property: 'session', name: 'session' },
      ],
      responses: {
        200: { description: 'OK', body: { kind: 'json', mediaType: 'application/json' } },
        404: { description: 'Not found', body: { kind: 'json', mediaType: 'application/json' } },
      },
      security: [{ bearerAuth: [] }],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});
```

The exact utility types may be factored for readability, but the observable contract is fixed:

1. The key under `operations` is the public `operationId`. It is explicit, not re-derived by each consumer.
2. `controller` and `handler` are checked together. The handler must be a callable instance member.
3. `method`, `path`, parameter placement, body representation, exact statuses, security, versioning, and deprecation are values in the declaration.
4. The generic type is the only source of parameter, body, and response application types.
5. The declaration is inert. Constructing it performs no I/O, route registration, network request, or global registration.
6. A build refuses a dynamic operation ID, method, path, handler name, status, media type, or version declaration. Generated artifact identity cannot depend on executing application code.

The runtime route table consumes compiled contracts through `registerContract`. Verb and controller decorators remain migration inputs checked for exact agreement; they are not a second final source.
OpenAPI now consumes only the compiled `HttpContractIR`; #683 removed its direct route, guard, version and schema collection.

## 4. The serialisable IR

`HttpContractIR` is pure data. It contains no constructors, handlers, validators, functions, symbols, class instances, credentials, URLs for a deployment, or mutable collection.

```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface HttpTypeIR {
  /** The one semantic type reflected by the existing AOT front-end. */
  readonly type: TypeIR;
  /** The OpenAPI/JSON-Schema projection produced during the same compilation. */
  readonly openApi: Readonly<Record<string, JsonValue>>;
}

export interface HttpContractIR {
  readonly format: 1;
  /**
   * Location-derived IDs to canonical type data. Consumers never reflect a type
   * or invent a second interpretation of it.
   */
  readonly types: Readonly<Record<string, HttpTypeIR>>;
  readonly operations: readonly HttpOperationIR[];
  readonly securitySchemes: Readonly<Record<string, SecurityScheme>>;
}

export interface HttpOperationIR {
  readonly operationId: string;
  readonly controller: string;
  readonly handler: string;
  readonly method: HttpMethod;
  /** Normalised zmdb route form, with `:name` path slots. */
  readonly path: string;
  readonly parameters: readonly HttpParameterIR[];
  readonly requestBody?: HttpRequestBodyIR;
  readonly responses: readonly HttpResponseIR[];
  /** Empty means explicitly public. An absent decision is not representable. */
  readonly security: readonly SecurityRequirement[];
  readonly version: HttpVersionIR;
  readonly deprecated: boolean;
}

export interface HttpParameterIR {
  readonly property: string;
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly typeId: string;
}

export type HttpBodyKind = 'json' | 'text' | 'bytes' | 'stream' | 'empty';

export type HttpBodyIR =
  { readonly kind: 'json'; readonly mediaType: string; readonly typeId: string } | { readonly kind: 'text' | 'bytes' | 'stream'; readonly mediaType: string } | { readonly kind: 'empty' };

export type HttpRequestBodyIR = Exclude<HttpBodyIR, { readonly kind: 'empty' }> & {
  readonly required: boolean;
};

export interface HttpResponseIR {
  readonly status: number;
  readonly description: string;
  readonly headers: readonly HttpResponseHeaderIR[];
  readonly body: HttpBodyIR;
  /**
   * Present only for media-type versioning. Each version has one exact representation.
   * Header-versioned shapes are identical and therefore need no per-version body.
   */
  readonly versions?: Readonly<Record<string, HttpBodyIR>>;
}

export interface HttpResponseHeaderIR {
  readonly property: string;
  readonly name: string;
  readonly description?: string;
  readonly required: boolean;
  readonly typeId: string;
}

export type HttpVersionIR =
  | { readonly kind: 'none' }
  | { readonly kind: 'neutral' }
  | { readonly kind: 'path'; readonly value: string }
  | {
      readonly kind: 'header';
      readonly name: string;
      readonly values: readonly string[];
      readonly default: string;
    }
  | {
      readonly kind: 'media-type';
      readonly key: string;
      readonly values: readonly string[];
      readonly default: string;
    };

export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export interface OAuthFlow {
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
}
export interface ImplicitFlow extends OAuthFlow {
  readonly authorizationUrl: string;
}
export interface PasswordFlow extends OAuthFlow {
  readonly tokenUrl: string;
}
export interface ClientCredentialsFlow extends OAuthFlow {
  readonly tokenUrl: string;
}
export interface AuthorizationCodeFlow extends OAuthFlow {
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
}

interface AllOAuthFlows {
  readonly implicit?: ImplicitFlow;
  readonly password?: PasswordFlow;
  readonly clientCredentials?: ClientCredentialsFlow;
  readonly authorizationCode?: AuthorizationCodeFlow;
}

export type OAuthFlows =
  | (AllOAuthFlows & { readonly implicit: ImplicitFlow })
  | (AllOAuthFlows & { readonly password: PasswordFlow })
  | (AllOAuthFlows & { readonly clientCredentials: ClientCredentialsFlow })
  | (AllOAuthFlows & { readonly authorizationCode: AuthorizationCodeFlow });

export type SecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'bearer'; readonly bearerFormat?: string; readonly description?: string }
  | { readonly type: 'http'; readonly scheme: 'basic'; readonly description?: string }
  | {
      readonly type: 'apiKey';
      readonly in: 'header' | 'query' | 'cookie';
      readonly name: string;
      readonly description?: string;
    }
  | { readonly type: 'mutualTLS'; readonly description?: string }
  | { readonly type: 'oauth2'; readonly flows: OAuthFlows; readonly description?: string }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string; readonly description?: string };
```

The implementation may attach generated functions to a separate compiled runtime record. Those functions are projections of the IR, not fields smuggled into it. OpenAPI and client generation read only
the serialisable IR; routing receives the IR plus the generated runtime plan from the same compilation result.

`HttpMethod` deliberately freezes the five methods the router accepts today. Adding `HEAD`, `OPTIONS`, `CONNECT`, or `TRACE` changes dispatch and response semantics and is a separate contract change,
not an accidental consequence of making the client generic.

Every `typeId` is location-derived, not hashed: `<operationId>/parameter/<in>/<property>`, `<operationId>/request/body`, `<operationId>/response/<status>/body`, or
`<operationId>/response/<status>/header/<property>`, with `/version/<value>` inserted before `/body` for a media-versioned response. A duplicate location is already a contract error. The stable
spelling makes generated output reviewable and watch invalidation independent of machine paths.

The existing AOT reflector creates one `TypeIR`; its existing emit back-ends produce codecs/validators and the `openApi` projection during the same compilation. An OpenAPI emitter reads only
`HttpTypeIR.openApi`. A client generator may ask the existing AOT emitter to compile `HttpTypeIR.type`, but does not define another type walk or ship the `TypeIR` in generated runtime code.

The generic declaration shape is also fixed. Absent locations are omitted, and every response status names a body plus any declared response-header object:

```ts
export interface HttpOperationTypes {
  readonly path?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly cookies?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly responses: Readonly<Record<number, { readonly body: unknown; readonly headers?: Readonly<Record<string, unknown>> }>>;
}
```

The compiler rejects a declared parameter/header `property` that does not exist in its corresponding group, an undeclared property in any group, a request `body` type with no request-body metadata, or
a response status/type present on only one side. An `empty` body uses `void`; text, bytes, and stream use their fixed public types; JSON is reflected.

## 5. Canonicalisation and diagnostics

The compiler produces byte-stable IR:

1. Operations sort by `operationId`.
2. Parameters preserve declaration order; duplicate `(in, name)` and duplicate `property` pairs are errors.
3. Responses sort by numeric status. A final status must be an integer from 200 through 599; informational responses are not observable as a final Fetch response.
4. Response headers preserve declaration order and are compared case-insensitively for duplicates.
5. Security scheme names and requirement keys sort lexically; scopes sort and deduplicate.
6. Version values preserve declaration order after duplicate rejection. The configured default must be present.
7. Media types are lower-cased and have optional whitespace normalised. Parameter values retain their case.
8. The contract object and every nested array/record exposed at runtime are frozen.

Diagnostics name the operation ID and the exact field. The build refuses:

- duplicate operation IDs when contracts are composed;
- duplicate final method/path/version keys;
- a missing or non-callable controller handler;
- a path placeholder with no path parameter, a path parameter with no placeholder, or an optional path parameter;
- a type property not assigned to exactly one parameter/body/response location;
- unsupported parameter or body types;
- an operation with no exact response status;
- a response body whose fixed kind disagrees with its type;
- undeclared security schemes, a protected route with no requirement, or a public route with a non-empty requirement;
- two schemes in one AND requirement that occupy the same wire name, or a scheme that collides with a declared parameter/version/content header;
- version shapes that the selected strategy cannot represent; and
- any `unsupported` TypeIR node.

No collector widens a refusal to `unknown`, omits a response, or silently falls back to OpenAPI.

## 6. Parameter wire rules

All component encoding uses RFC 3986 percent encoding: UTF-8 bytes, uppercase hexadecimal, spaces as `%20`, and `!'()*` escaped in addition to `encodeURIComponent`'s built-in set. It never uses `+`
for a space. Encoding happens exactly once.

| Location | Admitted application types                                                | Wire rule                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| path     | required scalar or scalar literal                                         | Replace exactly one matching `:name` segment with one encoded component. `/`, `?`, and `#` remain data as `%2F`, `%3F`, and `%23`.                              |
| query    | scalar, scalar literal, or readonly array of either; each may be optional | One pair per scalar. Arrays repeat the same key in input order. `undefined` and an empty array emit no pair. Declaration order determines pair-group order.     |
| header   | scalar or scalar literal; may be optional                                 | Lower-case the header name in `ClientRequest`; stringify once; reject CR, LF, and NUL before transport. Arrays and duplicate declared header names are refused. |
| cookie   | scalar or scalar literal; may be optional                                 | Append `name=encodedValue` to one `cookie` header in declaration order, separated by `; `. Arrays are refused.                                                  |

Scalar conversion is exact:

| Application value | Before component encoding                               |
| ----------------- | ------------------------------------------------------- |
| `string`          | unchanged                                               |
| finite `number`   | ECMAScript `String(value)`; `NaN` and infinities refuse |
| integer           | decimal integer spelling                                |
| `bigint`          | base-10 decimal without suffix                          |
| `boolean`         | `true` or `false`                                       |
| `Date`            | `toISOString()`                                         |
| scalar literal    | the rule for its primitive                              |

`null`, objects, tuples, nested arrays, unions with incompatible scalar spellings, and unsupported custom types are build refusals outside a body. A custom wire codec may make such a type scalar only
when the existing TypeIR/codec route supplies one deterministic string conversion.

The generated input groups locations explicitly:

```ts
client.get_users_id({
  path: { id },
  query: { expand: ['roles', 'teams'] },
  headers: { requestId },
  cookies: { session },
});
```

No property is guessed from a flat object, so the same name may exist in two locations without collision.

## 7. Request and response bodies

Each operation has at most one request representation. Each exact response status has one representation, except that media-type versioning may provide one response representation per version.
Supporting arbitrary content negotiation is not delegated to generated code.

An absent `requestBody` is the empty-request representation; a present request body cannot have kind `empty`. A response always has a body record, using kind `empty` when no bytes are permitted.

| Kind     | Request value                             | Response value                            | Rule                                                                                                   |
| -------- | ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `json`   | the declared application type             | the declared application type             | Generated codec converts wire/app values, serialises UTF-8 JSON, parses JSON, then validates/decodes.  |
| `text`   | `string`                                  | `string`                                  | UTF-8. Invalid response UTF-8 is a decode error rather than replacement text.                          |
| `bytes`  | `Uint8Array<ArrayBuffer>`                 | `Uint8Array<ArrayBuffer>`                 | Byte-for-byte. No `Buffer` API appears in the public or generated surface.                             |
| `stream` | `ReadableStream<Uint8Array<ArrayBuffer>>` | `ReadableStream<Uint8Array<ArrayBuffer>>` | Passed through once. Status/media type are checked; stream contents are not buffered or schema-walked. |
| `empty`  | no body property                          | `void`                                    | Sends no body or content type. A non-empty response is a protocol error.                               |

For JSON, `undefined` is omission only where the reflected property is optional. `null` is emitted only where the type admits it. A top-level `undefined`, a cyclic value, a non-finite number, or a
value the generated encoder cannot represent fails before transport.

The request `content-type` comes from the contract. The response `content-type` is checked case-insensitively after stripping parameters, except that media-type versioning compares its declared
version parameter too. A missing content type is allowed only for `empty`.

204, 205, and 304 responses are `empty` regardless of a transport-provided stream. The transport/runtime cancels that stream and never attempts to parse it.

## 8. Statuses and validation

Statuses are exact. There is no `2XX`, `default`, or inferred handler status in the IR.

- Exactly one documented 2xx status with no declared response headers: the generated method resolves to its decoded body type, or `void` for `empty`.
- Exactly one documented 2xx status with declared response headers: the generated method resolves to `{ body; headers }`, after decoding and validating both.
- Several documented 2xx statuses: the method resolves to a discriminated union `{ status; body; headers }`.
- A documented non-2xx status: its body and declared response headers are decoded and validated, then the runtime throws `ClientResponseError` carrying that typed data.
- An undocumented status: no response schema is guessed. The runtime throws `UnexpectedStatusError` with a bounded diagnostic body snippet.
- A documented status with the wrong media type, malformed bytes/JSON, or invalid decoded value throws the corresponding protocol/decode/validation error and never returns a partially trusted value.

The generator emits an operation-specific documented-error union and a type guard, because JavaScript promises cannot declare checked exceptions:

```ts
export type GetUsersIdError = ClientResponseError<404, NotFound> | ClientResponseError<409, Conflict>;

export function isGetUsersIdError(error: unknown): error is GetUsersIdError;
```

Response validation is generated from the same `TypeIR` carried by the response entry. It does not parse the OpenAPI document and does not retain a runtime TypeIR walker.

## 9. Security, authentication, and credentials

Every operation carries an explicit `security` array:

- `[]` means public.
- One object means every scheme in that object is required.
- Several objects mean alternatives, matching OpenAPI's OR-of-ANDs.

The contract carries scheme descriptions, never credentials. Generated files contain scheme names and requirements only.

`@zmdb/client` receives an authentication provider at construction or per call. It is called only for protected operations and receives the operation ID, declared requirements, scheme definitions, and
selected version. It returns a patch containing headers, query pairs, and cookies. The ordinary encoding rules then apply to that patch.

The runtime rejects:

- a protected operation with no provider;
- a provider result that satisfies none of the alternatives;
- CR/LF/NUL in an injected header;
- a case-insensitive collision with a contract-owned header;
- a collision with a declared query or cookie parameter; and
- an attempt to replace method, path, body, content type, accepted media type, or version.

TLS client certificates and transport-native authentication belong to the transport. A security scheme may tell the provider/transport what is required, but generated source never embeds a token,
password, API key, certificate, cookie, or deployment URL.

## 10. Versioning

The current three strategies remain the complete set.

### Path

The final contract declares one operation per exact path version. Several operations may bind the same controller handler, but each has its own explicit operation ID and expanded path. The generated
method has no version option. During migration only, the decorator collector may expand a multi-version legacy route, but it must be given one explicit operation ID per version; it may not derive
public names.

### Header

One operation carries the accepted values and required default. Request and response shapes are identical across versions. The generated method accepts:

```ts
options?: { readonly version?: '1' | '2' }
```

Omission selects the contract default; any other value is a compile-time error in generated code and a runtime error at an untyped boundary. The version header is contract-owned.

### Media type

The same version option rule applies. Request shape is identical across versions. Responses may vary by version and are selected by the exact versioned response media type. The generator emits
overloads so an explicit version has its exact result type and the omitted/default overload has the default result type.

### Neutral and unversioned

Neutral and unversioned operations expose no version option. Mixing neutral and specific handlers at the same final method/path remains a build error.

## 11. Routing, OpenAPI, and client consumers

The consumers do not recollect or reinterpret the contract:

- Routing binds each operation's controller/handler and uses its compiled path, version, request decoder, guards/security decision, and exact response plan.
- OpenAPI converts colon path slots to braces and renders the already-normalised parameters, bodies, responses, schemes, versions, deprecation flag, and each referenced `HttpTypeIR.openApi`
  projection.
- Client generation renders operation-specific TypeScript and precomputed request/response code.

Each consumer may project its own output format, but it may not:

- call `getRoutes`, `versionsOf`, `isPublic`, or guard resolution to reconstruct an operation;
- read handler source or signatures independently;
- parse generated OpenAPI;
- open another TypeScript program;
- walk TypeScript types, reinterpret `TypeIR`, or retain `TypeIR` at runtime; or
- invent an undocumented status, parameter, body, security requirement, or version.

## 12. Build and generated-artifact contract

The web contract compiler receives the consumer's existing `ReflectSession`; it does not open one per operation or per file. It asks the existing `Reflector` for each declared type and the existing
emitter for codecs, validators, and the OpenAPI projection.

The build result contains:

1. one serialisable `HttpContractIR`;
2. one compiled server plan with controller/handler binding plus request decoders;
3. one generator input carrying response validators/decoders;
4. diagnostics, all fatal to generation; and
5. dependency provenance for watch invalidation.

Generated client source:

- is stable for byte-identical IR and generator version;
- begins with a generated-file header carrying the contract format and generator version;
- sorts operations by operation ID;
- uses `.js` relative specifiers where it emits a relative import;
- contains no absolute path, workspace path, credential, TypeIR object, schema walker, controller import, or `@zmdb/web` runtime import;
- imports runtime values only from `@zmdb/client`; and
- emits no file change when bytes are already current.

`--check` compares bytes and writes nothing. Watch mode invalidates a contract when its declaration file or any file used by reflection changes; changing an unrelated file does not regenerate it.

## 13. Migration sequence

Implementation follows this order so every intermediate state is measurable:

1. #680 freezes present failures and final type/runtime boundaries.
2. #681 adds declaration helpers and the web contract compiler, initially comparing each compiled operation with the existing decorator route and `RouteOptions` metadata.
3. The router gains contract registration and consumes the compiled operation plan. A dual-declared route must agree exactly; disagreement is a startup/build error.
4. Each route moves method, path, body, status, security, version, and deprecation ownership into the contract. Its old decorator/schema/options declaration is then removed rather than forwarded.
5. #683 changed OpenAPI to accept only `HttpContractIR` and deleted `RouteSchemas`, `VersionSchemas`, operation-ID derivation, and direct route collection.
6. #682 and #684 land the independent client runtime and generated module.
7. #685 wires config/CLI generation and packed browser/Node consumers.
8. #686 updates public documentation only after the final imports and commands exist.

There is no compatibility overload for `toOpenApi(controllers, options.schemas)` or path-keyed schemas after step 5.

## 14. Acceptance owned by #680

The tests freeze must cover at least:

1. the worked operation producing one unambiguous request plan;
2. every parameter location and scalar conversion rule;
3. JSON, text, bytes, stream, and empty body plans;
4. one and several successful statuses, documented errors, and an undocumented status;
5. exact response validation and malformed media/body refusals;
6. caller abort, timeout, transport failure, and stream cancellation;
7. public, one-requirement, and alternative security shapes with credential-free generated text;
8. all three version strategies and version-dependent media responses;
9. deterministic IR/source output and operation collision diagnostics;
10. one compiler session and no second TypeScript/TypeIR walker;
11. zero runtime dependencies and no web import from generated code; and
12. present-state failures caused by the measured path-keyed schema and adapter gaps rather than by invented stubs.

The first two executable titles are frozen exactly:

- `the frozen operation example renders one unambiguous request plan`
- `every supported body and parameter location has a specified wire representation`

## 15. Non-goals

- Parsing arbitrary OpenAPI documents.
- Inferring statuses by executing or reading handler bodies.
- A cache, retry scheduler, deduplication layer, or frontend state store.
- GraphQL, WebSocket event protocols, gRPC, or broker messages.
- Multipart form generation. Uploads may be added later as an explicit body kind with their own limits and streaming contract.
- General OpenAPI style/explode support. The wire rules in §6 are the supported grammar.
- A custom version extractor or query-string API version.
- Runtime reflection, runtime TypeIR traversal, or an application-global contract registry.
