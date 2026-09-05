# `@zmdb/client` — dependency-free HTTP client runtime SPEC

> Issue #679, parent #678. Frozen before package creation. Operation-specific code is generated from `@zmdb/web/contract`; this package owns only transport-neutral execution and stable errors.

## 1. Package boundary

`@zmdb/client` is ESM-only and has:

- zero `dependencies`;
- zero `peerDependencies`;
- no import from `@zmdb/web`, `@zmdb/aot-validator`, `@zmdb/schema-core`, Node built-ins, OpenAPI tooling, or a frontend framework;
- no global registry, ambient client, cache, retry loop, or request scheduler; and
- only language and web-platform primitives: `URL`, `AbortController`, `AbortSignal`, `ReadableStream`, `TextEncoder`, `TextDecoder`, `Request`, `Response`, and an injected `fetch`.

The package is independently usable without generated code.

## 2. Public runtime surface

```ts
export type ClientHeaders = Readonly<Record<string, string>>;

export type ClientBody = string | Uint8Array | ReadableStream<Uint8Array>;

export interface ClientRequest {
  readonly method: string;
  readonly url: string;
  /** Lower-case names, one normalised value per name. */
  readonly headers: ClientHeaders;
  readonly body?: ClientBody;
  readonly signal?: AbortSignal;
}

export interface ClientResponse {
  readonly status: number;
  /** Lower-case names, one normalised value per name. */
  readonly headers: ClientHeaders;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type ClientTransport = (request: ClientRequest) => Promise<ClientResponse>;

export type ClientSecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type ClientSecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'bearer' | 'basic' }
  | { readonly type: 'apiKey'; readonly in: 'header' | 'query' | 'cookie'; readonly name: string }
  | { readonly type: 'mutualTLS' }
  | { readonly type: 'oauth2' }
  | { readonly type: 'openIdConnect' };

export interface AuthenticationContext {
  readonly operationId: string;
  readonly requirements: readonly ClientSecurityRequirement[];
  readonly schemes: Readonly<Record<string, ClientSecurityScheme>>;
  readonly version?: string;
  readonly signal?: AbortSignal;
}

export interface AuthenticationPatch {
  readonly requirement: number;
  readonly headers?: ClientHeaders;
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
  readonly cookies?: Readonly<Record<string, string>>;
}

export type AuthenticationProvider = (context: AuthenticationContext) => AuthenticationPatch | Promise<AuthenticationPatch>;

export interface ClientOptions {
  readonly baseUrl: string | URL;
  readonly transport?: ClientTransport;
  readonly authentication?: AuthenticationProvider;
  readonly headers?: ClientHeaders;
  readonly maxResponseBytes?: number;
  readonly maxErrorBodyBytes?: number;
}

export interface CallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly authentication?: AuthenticationProvider;
}

export interface ClientQueryPair {
  /** Unencoded contract name. */
  readonly name: string;
  /** Scalar wire spelling before RFC 3986 component encoding. */
  readonly value: string;
}

export interface PreparedClientRequest {
  /** Contract path with every slot already replaced by one encoded component. */
  readonly path: string;
  readonly query: readonly ClientQueryPair[];
  readonly headers: ClientHeaders;
  readonly cookies: readonly ClientQueryPair[];
  readonly body?: ClientBody;
}

export type ClientVersionPlan =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'header' | 'media-type';
      readonly values: readonly string[];
      readonly default: string;
    };

export type DecodeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface ClientResponseBody {
  empty(): Promise<void>;
  json<T>(mediaType: string, decode: (wire: unknown) => DecodeResult<T>): Promise<T>;
  text(mediaType: string): Promise<string>;
  bytes(mediaType: string): Promise<Uint8Array>;
  stream(mediaType: string): ReadableStream<Uint8Array>;
}

export interface ClientOperationResponse {
  readonly status: number;
  readonly headers: ClientHeaders;
  readonly body: ClientResponseBody;
  unexpectedStatus(): Promise<never>;
}

export interface GeneratedOperation<Input, Result> {
  readonly abi: 1;
  readonly operationId: string;
  readonly method: string;
  readonly security: readonly ClientSecurityRequirement[];
  readonly schemes: Readonly<Record<string, ClientSecurityScheme>>;
  readonly version: ClientVersionPlan;
  prepare(input: Input, version: string | undefined): PreparedClientRequest;
  read(response: ClientOperationResponse, version: string | undefined): Promise<Result>;
}

export interface ClientRuntime {
  call<Input, Result>(operation: GeneratedOperation<Input, Result>, input: Input, options?: CallOptions & { readonly version?: string }): Promise<Result>;
}

export const CLIENT_RUNTIME_ABI = 1;
export function createClientRuntime(options: ClientOptions): ClientRuntime;
export function createFetchTransport(fetch?: typeof globalThis.fetch): ClientTransport;
```

This is the complete generated-code ABI; generated modules do not reach an unexported helper. `prepare` and `read` are emitted straight-line functions from the contract. The runtime owns URL assembly,
header/cookie conflict checks, authentication, cancellation, transport invocation, bounded body readers, content-type checks, and stable errors. `read` performs only status dispatch, generated
response-header conversion, and calls to the bounded `ClientResponseBody` methods.

`ClientSecurityScheme` is deliberately the transport projection rather than a type import from `@zmdb/web`: descriptions, OAuth discovery URLs, and flow documentation do not affect request
construction. Generated source derives this credential-free projection from the full contract.

## 3. Base URLs and final request identity

`baseUrl` is either:

- an absolute `http:` or `https:` URL; or
- an origin-relative path beginning with `/`.

Other relative spellings, credentials in the URL, a query, or a fragment are construction errors. The base pathname is a prefix: `https://api.example/v1` plus `/users/:id` produces
`https://api.example/v1/users/<id>`, not `https://api.example/users/<id>`. Duplicate boundary slashes collapse and the root remains `/`.

The generated plan owns method, path, declared query pairs, body, content type, accepted response media type, and version. Authentication may add only its declared patch. The transport receives the
final immutable request and cannot be asked to re-encode contract data.

An origin-relative base remains origin-relative in `ClientRequest.url`. It is valid for browser/custom transports; Node's built-in Fetch rejects it, and `createFetchTransport` reports that rejection
as `TransportError`. A Node caller uses an absolute base URL.

## 4. Header normalisation and conflicts

All request and response header names are lower-case. `createFetchTransport` normalises `Headers` into that form. Request values are not trimmed or rewritten; response values are the strings exposed
by the transport's `Headers` implementation.

Construction-time headers are applied first, then declared operation headers, version/content negotiation headers, and authentication. A later source may not silently replace an earlier
case-insensitive name:

- identical values collapse to one value;
- different values throw `ClientRequestError`;
- `content-type`, `accept`, and the configured version header are always contract-owned; and
- `content-length`, `host`, `connection`, and transfer framing are always transport-owned.

CR, LF, and NUL are rejected before the transport is called.

## 5. Fetch transport

`createFetchTransport()` uses the supplied function or `globalThis.fetch`. It:

1. passes the exact method, URL, headers, body, and signal;
2. uses manual redirect handling so a generated operation observes the status declared by its contract rather than an implicit second request;
3. sets the platform's streaming-request option when a `ReadableStream` body requires one;
4. does not add credentials, cookies, retries, timeouts, or default headers;
5. returns status, normalised headers, and the response stream without buffering; and
6. wraps a non-abort rejection as `TransportError` with the original value as `cause`.

An opaque browser redirect that exposes no usable status is a transport/protocol error. Following redirects is an explicit custom transport policy, not generated-client behaviour.

The Fetch standard does not portably let script set a `cookie` request header. To avoid a request that appears authenticated in the generated plan but is silently stripped in a browser,
`createFetchTransport` refuses an explicit `cookie` header with `ClientRequestError` before calling Fetch. Cookie parameters and cookie API-key injection therefore require a transport that owns a
cookie jar/header policy. Ambient browser credentials are not evidence that an explicit contract cookie was sent.

## 6. Body limits and decoding

Defaults:

```ts
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_ERROR_BODY_BYTES = 8 * 1024;
```

Both options must be positive safe integers.

For a buffered body, the runtime checks a declared `content-length` before reading and counts bytes while reading. Exceeding the limit cancels the stream and throws `ResponseTooLargeError`. It does
not return a truncated successful value.

The smaller error-body limit is used for diagnostic snippets on undocumented statuses and malformed bodies. Snippets are UTF-8 with invalid sequences replaced and are explicitly diagnostic, never
passed to a validator.

Streaming operation results are not buffered and do not use `maxResponseBytes`; ownership transfers to the caller. If setup fails after a response stream exists, the runtime cancels it before
throwing.

JSON and text decoding uses UTF-8. A declared text or JSON response with malformed UTF-8 throws `ResponseDecodeError`. JSON syntax failure throws the same class with the parse error as `cause`.
Generated validation happens after parse and wire-to-application decoding.

## 7. Cancellation and timeout ownership

The caller owns `CallOptions.signal`. The runtime never aborts that controller. The timeout starts when `call` begins and covers asynchronous authentication, transport setup, and buffered response
reading.

- If the caller signal is already aborted, the transport is not called and the promise rejects with the exact `signal.reason`.
- If it aborts during authentication or in flight, the transport signal aborts with that exact reason. A later provider/transport rejection is replaced with the winning reason rather than wrapped.
- `timeoutMs` must be a positive finite integer. The runtime creates its own controller and aborts it with one `ClientTimeoutError` instance when the deadline expires.
- When both exist, the first abort reason wins. Listener and timer cleanup happens on every settle path.
- Aborting after the promise settles has no effect.
- Returning a response stream settles the call and clears its timeout. Cancelling that stream remains the caller's operation and propagates to the transport stream.

No generated method silently assigns a timeout or retry count.

## 8. Authentication

A protected operation calls the per-call provider when present, otherwise the client provider. Public operations do not call either.

The provider chooses one declared alternative by its zero-based `requirement` index and returns only headers, query values, and cookies. The runtime verifies that the selected alternative exists, that
the patch supplies every non-transport-owned scheme in it at that scheme's exact declared location, and that it supplies no extra name. Patches are applied in the selected requirement's lexically
normalised scheme order, not JavaScript record insertion order. API keys are one scalar. HTTP bearer/basic, OAuth2, and OpenID Connect supply one `authorization` header value; the runtime does not
assemble or retain a token.

Provider failures throw `AuthenticationError` with the original cause. Missing credentials throw `MissingAuthenticationError`. Authentication material is not retained after request construction,
logged, added to an error message, or emitted into generated source.

Mutual TLS remains transport-owned. The provider may select that requirement but cannot represent a certificate as a header/query/cookie patch.

## 9. Error classes

Every class extends `ClientError`, sets a stable `name`, and carries `operationId` where an operation had been selected.

```ts
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ClientErrorInit {
  readonly operationId?: string;
  readonly cause?: unknown;
}

export class ClientError extends Error {
  readonly operationId: string | undefined;
  constructor(message: string, init?: ClientErrorInit);
}
export class ClientRequestError extends ClientError {}
export class AuthenticationError extends ClientError {}
export class MissingAuthenticationError extends AuthenticationError {}
export class TransportError extends ClientError {}
export class ClientTimeoutError extends ClientError {
  readonly timeoutMs: number;
}
export class ResponseTooLargeError extends ClientError {
  readonly status: number;
  readonly limit: number;
}
export class UnexpectedStatusError extends ClientError {
  readonly status: number;
  readonly headers: ClientHeaders;
  readonly bodySnippet: string;
}
export class UnexpectedContentTypeError extends ClientError {
  readonly status: number;
  readonly expected: readonly string[];
  readonly received: string | undefined;
}
export class ResponseDecodeError extends ClientError {
  readonly status: number;
  readonly bodySnippet: string;
}
export class ResponseValidationError extends ClientError {
  readonly status: number;
  readonly issues: readonly ValidationIssue[];
}
export class ClientResponseError<Status extends number, Body, Headers = ClientHeaders> extends ClientError {
  readonly status: Status;
  readonly body: Body;
  readonly headers: Headers;
}
```

`ValidationIssue` is structurally declared here, not imported from schema-core. Generated validators return the same string-path `{ path, message }` shape already used by zmdb.

Constructor signatures are part of the ABI:

- `new ClientRequestError(message, init?)` for invalid base URLs/options, request encoding, header conflicts, explicit cookies under Fetch, and ABI mismatch.
- `new AuthenticationError(operationId, cause)` and `new MissingAuthenticationError(operationId)`.
- `new TransportError(operationId, cause)`.
- `new ClientTimeoutError(operationId, timeoutMs)`.
- `new ResponseTooLargeError(operationId, status, limit)`.
- `new UnexpectedStatusError(operationId, status, headers, bodySnippet)`.
- `new UnexpectedContentTypeError(operationId, status, expected, received)`.
- `new ResponseDecodeError(operationId, status, bodySnippet, cause?)`.
- `new ResponseValidationError(operationId, status, issues)`.
- `new ClientResponseError(operationId, status, body, headers)`, where generated code supplies the decoded response-header type.

Error messages never contain credentials or an unbounded body. They name the operation, status/limit/media type, and the bounded actionable detail.

## 10. Generated module shape

For one ordinary successful response:

```ts
export interface ApiClient {
  get_users_id(
    input: {
      readonly path: { readonly id: string };
      readonly query?: { readonly expand?: readonly string[] };
      readonly headers?: { readonly requestId?: string };
      readonly cookies: { readonly session: string };
    },
    options?: CallOptions,
  ): Promise<User>;
}

export function createApiClient(options: ClientOptions): ApiClient;
```

Rules:

1. The method name is the explicit operation ID and must be a valid non-reserved TypeScript identifier. Otherwise generation fails with an instruction to rename the operation.
2. A location group is required when it has a required member; otherwise the group is optional.
3. Empty groups are omitted.
4. One successful response with no declared response headers resolves directly to its body. One with declared headers resolves to `{ body; headers }`; several successful statuses resolve to a
   status-discriminated union.
5. Documented non-2xx types are exported as an operation-specific error union plus type guard.
6. Header/media version operations receive generated version overloads. Path/neutral/unversioned operations do not.
7. Generated request encoders and response validators are straight-line code or hoisted helpers. They do not inspect TypeIR or JSON Schema at runtime.
8. Generated code imports runtime values only from `@zmdb/client`. It may emit its own public structural types; it does not import controller modules.

## 11. Determinism and regeneration

The generator is a pure function of:

- `HttpContractIR` format/version;
- generator version; and
- explicit generator options that affect output.

It sorts operations by operation ID, statuses numerically, and generated helper names by first use in that order. It uses LF, the repository quote style, `.js` relative specifiers, and a fixed
generated header. It emits no timestamp, absolute path, machine path, package-manager path, random suffix, or source-order-dependent hash.

`--check` compares bytes and writes nothing. A normal run uses an atomic replacement and preserves the existing file when bytes are equal, including its mtime.

Generation accepts exactly `HttpContractIR.format === 1`; an unknown format is a build error and writes nothing. Every operation literal carries `abi: 1`, and `createClientRuntime` compares it with
`CLIENT_RUNTIME_ABI` before authentication or transport. Changing that generated/runtime ABI requires a major `@zmdb/client` release; adding a backward-compatible operation field does not. This gives
a checked failure when a committed generated file and installed runtime come from incompatible generations.

## 12. Required acceptance

The implementation issues must prove:

1. the package imports with no other package installed;
2. an injected transport works without global `fetch`;
3. absolute and origin-relative base prefixes resolve as specified;
4. all parameter encodings match the contract SPEC;
5. JSON, text, bytes, empty, and stream bodies follow their ownership/limit rules;
6. documented success, documented error, undocumented status, wrong media type, malformed body, and invalid decoded value are distinct outcomes;
7. caller abort reason identity and timeout identity are preserved;
8. authentication is per request and no credential appears in generated text or error output;
9. a fake transport under a testing subpath can deterministically hold, answer, fail, and observe cancellation;
10. generated output is byte-identical across two runs; and
11. packed browser and Node consumers execute the same generated operation against a real web fixture.

## 13. Non-goals

- Cache invalidation, request deduplication, optimistic updates, retries, polling, or offline queues.
- React, Angular, Vue, Svelte, Solid, React Native, or meta-framework lifecycle primitives.
- OpenAPI parsing.
- Cookie jars, browser credential policy, TLS configuration, proxy configuration, or Node agents in the core package.
- Automatic redirect following.
- Runtime schema or contract traversal.
