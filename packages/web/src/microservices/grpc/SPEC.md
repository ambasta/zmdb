# SPEC — gRPC: the service declaration, four call types, and one source of truth (frozen)

Part of `@zmdb/web`, a new `./microservices/grpc` subpath. `../SPEC.md` owns brokers; this file owns gRPC, and §1 is why those are two files rather than two sections.

`@grpc/grpc-js` is an **optional peer dependency**, per `#556`'s constraint that installing `@zmdb/web` must not pull in five brokers. The adapter neither imports nor directly declares
`@grpc/proto-loader`; grpc-js carries it transitively for its own optional facilities, and §3 explains why this surface never invokes it.

## 1. gRPC is not a broker, so almost nothing in `../SPEC.md` applies

Everything the sibling file decides is about a message whose sender has already gone away: who acknowledges, what a retry delay is, where a poisoned message goes. gRPC has none of those problems,
because a gRPC call is a **synchronous request over an open HTTP/2 stream with a caller waiting on the other end**.

| `../SPEC.md` decision                  | gRPC                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| `Settlement` — ack / retry / dead      | not applicable; the reply _is_ the acknowledgement                    |
| redelivery and `deliveryAttempt`       | not applicable; a failed call is the caller's to retry                |
| invalid payload is `dead` (§6.1 there) | invalid payload is `INVALID_ARGUMENT` back to the caller, immediately |
| `retry.afterMs`                        | not applicable; the client owns backoff                               |
| correlation ids (§8 there)             | not needed; the HTTP/2 stream _is_ the correlation                    |
| required request timeout (§7 there)    | the caller's deadline, propagated in metadata (§6)                    |
| `TransportStrategy`                    | not used; gRPC has its own typed binding                              |

That last row is the decision to defend. It is tempting to make gRPC one more strategy, so `AppOptions.transports` covers it and there is a single startup path. It is refused because
`TransportStrategy.listen(dispatch)` maps a pattern string to a handler and gRPC does not have patterns — it has a service with a fixed method set, a declared type per direction per method, and a
streaming flag on each side.

Forcing it through `RawMessage` would mean discarding every one of those and re-deriving them inside the gRPC layer from data it just erased. Two narrow contracts beat one contract that fits neither,
which is `ARCHITECTURE.md` §2.6 applied to the shape of the abstraction rather than to the count of its methods.

What gRPC does share is the lifecycle: it is started by `createApp`'s `init()` and closed before the shutdown hooks run, exactly as a transport is (`../SPEC.md` §10), and `AppOptions` gains one member
for it (§9).

## 2. TypeScript is the source of truth — the direction `#557` has backwards

`#557` step 8 asks for "proto loading" and step 9 for "a proto-derived TypeScript type". **Both describe the wrong direction, and the right one is already frozen and closed.**
`../../../../aot-validator/src/emit/SPEC.md` §7b froze:

```ts
protoEncode<T>(value: T): Uint8Array;
protoDecode<T>(bytes: Uint8Array): T;
protoDescriptor<T>(): string; // the .proto text, for the other language
```

Those three message entry points now ship alongside `grpcDescriptor` and `loadGrpcService`. The latter is the generated grpc-js artifact: descriptor, method paths, streaming flags, validators and
codecs from the same reflected service type.

`.proto` is **output**. The declared TypeScript type carrying `ProtoField<N>` and `Proto<K>` tags (`../../../../schema-core/src/ir/SPEC.md` §4.5) is the input. That is the same decision the whole
project rests on and the same one `web-microservices-grpc.md` reached on its own before this freeze — "generate `.proto` _from_ the declared type rather than the reverse, keeping one source of truth".

Following the issue's text literally would have produced two schema sources, which the page itself names as "the specific problem the project's type-derived design exists to avoid". So the steps are
inverted here rather than implemented, and this paragraph exists so the inversion reads as a decision rather than as a slice that misunderstood its issue.

Consuming somebody else's `.proto` is a real need and it is **out of scope**: it is a code generator that emits a `.d.ts`, which is the same one-source-of-truth answer run in the other direction and
can be built later without touching a line of runtime. What is refused is a runtime parser, not interoperability.

## 3. This adapter never parses a `.proto`

`#557` step 8 asks for build-time proto loading and says to explain why not runtime. The answer here is stronger than build-time: **there is no `.proto` on the read path at all.**

Calling `@grpc/proto-loader` would parse a `.proto` file at process start and produce an object whose types are `any` or hand-declared. That would add startup I/O, a second implementation of the
protobuf grammar, and an untyped boundary. The package is present transitively under grpc-js, but importing grpc-js alone does not load it and this adapter has no call site for it.

Instead, the descriptor and executable service artifact are produced from the declared types:

```ts
grpcDescriptor<S extends GrpcServiceDef>(service: string, pkg: string): string;
loadGrpcService<S extends GrpcServiceDef>(
  service: string,
  pkg: string,
): GrpcLoadedService<S>;
```

It emits the `service` block and every message block it references, so the artifact a Go or Python team consumes is generated from the same declaration the handlers are checked against. Commit it and
diff it in CI, and the contract-change review that `.proto` files are prized for is a pull request — which is exactly what `web-microservices-grpc.md` already recommends doing with an OpenAPI
document.

`grpcDescriptor` belongs to this gRPC epic but lives in `@zmdb/aot-validator`, next to `protoDescriptor`, **not here**. `@zmdb/web` does not gain a `TypeIR` walker; the walker exists once and this
epic calls it. §8 is the rest of that boundary.

The `ServiceDefinition` object `@grpc/grpc-js`'s `Server.addService` wants is built from `loadGrpcService`'s generated method table. Each entry carries the same validators and protobuf codecs the
standalone message calls emit. That is the entire reason `@grpc/proto-loader` is unnecessary: everything it would have produced is already available in a typed build artifact.

## 4. The service declaration and the binding

```ts
export interface GrpcMethodDef {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
}

export type GrpcServiceDef = { readonly [method: string]: GrpcMethodDef };

export type GrpcHandlers<S extends GrpcServiceDef> = { readonly [M in keyof S]: GrpcHandler<S[M]> };

export declare function bindGrpcService<S extends GrpcServiceDef>(service: GrpcServiceSpec<S>, handlers: GrpcHandlers<S>): GrpcBinding;

export interface GrpcServiceSpec<S extends GrpcServiceDef> {
  readonly definition: GrpcLoadedService<S>;
  readonly validateMetadata: (metadata: GrpcMetadata) => GrpcMetadata;
  readonly onError: (failure: GrpcFailure) => void;
  readonly maxDurationMs?: number;
}
```

**A mapped type, and there is no `@GrpcMethod` decorator.** `#557`'s API surface proposes one; it is refused for the reason `../cqrs/SPEC.md` §3 refuses `@CommandHandler`, plus one that is decisive
here and nowhere else: a gRPC service is a **closed contract shared with another language**, so the property worth paying for is exhaustiveness — a service with an unimplemented method must not
compile — and a decorator cannot have it.

A decorated class missing a method is a class, and the omission surfaces as `UNIMPLEMENTED` at the caller.

`GrpcHandlers<S>` has it: omitting one method from a four-method service is `TS2741` naming that missing property; omitting two or more is `TS2739`. Brokers keep decorators for the mirror-image reason
(`../SPEC.md` §4): a pattern set is open-ended, so there is nothing to be exhaustive against.

**`requestStream` and `responseStream` are `?: true`, never `boolean`.** Under `exactOptionalPropertyTypes` a `?: false` member is a value nobody can usefully write — `false` and absent mean the same
thing, so the option is dead weight that two people will spell differently. Present-or-absent is one spelling for one fact, and it is what makes §5's conditional type readable.

**A service must be declared as a `type` alias, not an `interface`.** This is a verified TypeScript constraint, and it is the one way to hold this API that produces an error naming a type the user did
not write. An `interface` has no implicit index signature, so `GrpcHandlers<OrdersInterface>` fails with `TS2344` — "Index signature for type 'string' is missing".

Adding `extends GrpcServiceDef` to fix that makes it worse: the inherited index signature appears in `keyof`, so the mapped type acquires a `string` member whose handler type is
`(call: GrpcCall<unknown>) => Promise<unknown>`, and every correct method now fails against it. The same rule governs `ClientPatterns` (`../SPEC.md` §2.4) and is stated in both places.

```ts
type Orders = {
  readonly get: { request: GetOrder; response: Order };
  readonly upload: { request: Chunk; response: UploadAck; requestStream: true };
  readonly watch: { request: WatchOrders; response: Order; responseStream: true };
  readonly chat: { request: Note; response: Note; requestStream: true; responseStream: true };
};
```

## 5. The four call types are one type, and the signature follows the declaration

```ts
export interface GrpcCall<T> {
  readonly kind: 'grpc';
  readonly service: string;
  readonly method: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly binaryHeaders: Readonly<Record<string, Uint8Array>>;
  readonly peer: string;
  readonly signal: AbortSignal;
  remainingMs(): number;
  setTrailer(key: string, value: string): void;
}

export type GrpcHandler<D extends GrpcMethodDef> = D extends { requestStream: true }
  ? D extends { responseStream: true }
    ? (call: GrpcCall<AsyncIterable<D['request']>>) => AsyncIterable<D['response']>
    : (call: GrpcCall<AsyncIterable<D['request']>>) => Promise<D['response']>
  : D extends { responseStream: true }
    ? (call: GrpcCall<D['request']>) => AsyncIterable<D['response']>
    : (call: GrpcCall<D['request']>) => Promise<D['response']>;
```

| Call type        | Declaration            | Handler signature                                            |
| ---------------- | ---------------------- | ------------------------------------------------------------ |
| unary            | neither flag           | `(call: GrpcCall<Req>) => Promise<Res>`                      |
| client streaming | `requestStream: true`  | `(call: GrpcCall<AsyncIterable<Req>>) => Promise<Res>`       |
| server streaming | `responseStream: true` | `(call: GrpcCall<Req>) => AsyncIterable<Res>`                |
| bidirectional    | both flags             | `(call: GrpcCall<AsyncIterable<Req>>) => AsyncIterable<Res>` |

**There is one decorator-equivalent, not four.** Nest needs `@GrpcMethod` and `@GrpcStreamMethod` because it cannot know at bind time which side streams — the information lives in a `.proto` it loaded
into an untyped object.

Here the descriptor is generated from the declaration, so the streaming flags are known statically _and_ present in the artifact the binding reads, and the handler's shape is checked against them.

A unary function where a server stream is declared is `TS2741` — "Property '[Symbol.asyncIterator]' is missing in type 'Promise<Order>'" — which is a compile error at the handler rather than a
protocol error at the caller.

A streaming handler is an `AsyncIterable`, which in practice is an `async function*`. Cancellation is `AbortSignal`-driven with no framework `unsubscribe`. The adapter also owns both iterator cleanup
paths: it calls `return()` when a response consumer stops reading, and its request iterable races each pending `next()` against `call.signal`. An `AbortSignal` does not interrupt an arbitrary iterable
by itself; the adapter must make that relationship explicit so a suspended `for await` exits and `finally` runs.

**`web-microservices-grpc.md` claimed streaming RPC was "blocked by the string response body". That is wrong and is corrected on the page.** `WebResponse` (`../../pipeline/SPEC.md` §22) is the HTTP
pipeline's type; a gRPC stream never touches it, and `toNodeHandler`'s tagged response-body handling is not on this path at all. The gRPC service descriptor, binding and all four streaming
combinations now ship on `@zmdb/web/microservices/grpc`.

## 6. Deadlines, and propagating what is left of one

A gRPC client sends `grpc-timeout` as metadata on every call that has a deadline. `GrpcCall` exposes it two ways because two things need it and they need it in different forms:

- `signal` — an `AbortSignal` that aborts when the deadline passes or the caller cancels. This is what a handler passes to anything cancellable, and the reason there is no separate `onCancelled`
  callback.
- `remainingMs()` — the budget left, in milliseconds, read at the moment of the call rather than captured.

**Propagation is the point of `remainingMs()`, and not propagating is the failure it prevents.** A handler that calls another service must pass the remaining budget rather than that service's own
default. Otherwise three services each with a 5-second deadline take 15 seconds while the original caller left after 5, and every one of the three logs a success.

So an outbound call inside a handler uses `remainingMs()` as its timeout, and a `MessageClient` (`../SPEC.md` §2.4) invoked from a gRPC handler should be constructed per call with that value rather
than at startup with a constant.

A call with **no** deadline is served, and `remainingMs()` returns `Number.POSITIVE_INFINITY`. It is the caller's right to omit one and not this server's business to invent one — but `GrpcServiceSpec`
may carry a `maxDurationMs` that aborts `signal` regardless, because a server that can be pinned open by a client that never hangs up has an availability problem rather than a politeness problem.

## 7. Metadata, trailers, and the binary keys

`headers` is `Readonly<Record<string, string>>` — the same type as `Ctx.headers` and `MessageContext.headers`, character for character, so a `GrpcCall` satisfies `WithHeaders` (`../SPEC.md` §3.1) and
one authorisation function serves HTTP, GraphQL, messages and gRPC. That is the payoff for having spelled the shared portion structurally instead of nominally.

Binary metadata — gRPC's `-bin`-suffixed keys — is a **separate member**, `binaryHeaders`, typed `Readonly<Record<string, Uint8Array>>`. Two candidate alternatives were both rejected. Folding it into
`headers` base64-encoded means one map whose values are sometimes text and sometimes an encoding, decided by a suffix, and a reader who forgets the suffix rule gets a plausible-looking wrong string.
Dropping binary keys silently loses data a caller sent deliberately. A second map costs one member and cannot be misread.

`Uint8Array` rather than `Buffer` — `.oxlintrc.json:60` bans `Buffer` with "Use Uint8Array and ArrayBuffer for binary data", and it is the same type `protoEncode` returns, so the two halves of the
binary story agree. `@grpc/grpc-js` hands incoming bytes to the adapter as a `Buffer`, which is already a `Uint8Array`. Its outgoing serializer contract is stricter and internally calls `Buffer.copy`,
so the adapter converts the generated `Uint8Array` at that private grpc-js boundary. No `Buffer` appears in the public surface.

`setTrailer` exists because trailers are the only place a streaming handler can report a per-call fact after it has started emitting — a row count, a cursor. There is no `setHeader`: response metadata
is sent when the first message is, and a handler that "set a header" after its first `yield` would be silently ignored. An API that cannot express the mistake is better than one that documents it.

## 8. Errors: a status code, never the message

```ts
export type GrpcStatus =
  | 'OK'
  | 'CANCELLED'
  | 'INVALID_ARGUMENT'
  | 'DEADLINE_EXCEEDED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'FAILED_PRECONDITION'
  | 'UNIMPLEMENTED'
  | 'INTERNAL'
  | 'UNAVAILABLE'
  | 'UNAUTHENTICATED';

export class GrpcError extends Error {
  readonly status: GrpcStatus;
  readonly details: string; // sent to the caller — must be safe to disclose
}

export interface GrpcFailure {
  readonly service: string;
  readonly method: string;
  readonly status: GrpcStatus;
  readonly error: unknown; // the real one — never leaves the process
}
```

A thrown `GrpcError` is sent as its `status` and its `details`. **Anything else becomes `INTERNAL` with a fixed string, and the real error goes to `onError` instead.** `web-microservices-grpc.md`
already states the reason — "a gRPC error message propagates to the caller, and a database error string discloses schema and topology" — and making it the default rather than the advice is the
difference between a documented practice and a property.

`onError` is required on `GrpcServiceSpec`, the same requirement and the same argument as `../events/SPEC.md` §3: the alternatives are silence, which loses every internal failure, and `console.error`,
which invents a logger this project has never had.

A malformed frame that `protoDecode` rejects is `INVALID_ARGUMENT`, not `INTERNAL`. Protobuf decoding is not a complete application validator: implicit absence fills scalar zero values, an
incompatible wire form is skipped, and validation tags such as bounds or patterns are outside the codec. A binding that promises those constraints must run the emitted `assert<T>` after decoding.

A literal union rather than a numeric `enum`: the wire values are gRPC's and the adapter maps to them in one place, so the numbers never appear in application code, and a union is what every other
status-like type in this project already is.

## 9. Startup, shutdown, and the hybrid arrangement

```ts
export interface GrpcBinding {
  readonly service: string;
  readonly methods: readonly string[];
}

export interface GrpcServerOptions {
  readonly address: string;
  readonly bindings: readonly GrpcBinding[];
  readonly credentials: 'insecure' | GrpcServerTlsOptions;
}
```

`AppOptions` (`../SPEC.md` §10) gains `readonly grpc?: GrpcServerOptions`, and everything else follows that file's ordering with no exception: the server binds in `init()` after
`runInit(lifecycleInstances)`, a failed bind rejects `init()` and closes what was already opened, and the server shuts down before the shutdown hooks run so no handler outlives the repository it uses.

`credentials` is **required and has no default.** `createInsecure()` as a default is how a service ends up serving plaintext in production with credentials in metadata — `web-microservices-grpc.md`
names it — and `'insecure'` as an explicit, greppable string is the difference between a decision and an omission. It is the same rule `../SPEC.md` applies to `timeoutMs` and `close(graceMs)`: the
value that matters is stated by whoever knows the deployment.

Graceful shutdown calls `tryShutdown` and, after the app's `graceMs`, `forceShutdown`. An unbounded `tryShutdown` waits for the longest open stream, and a bidirectional stream is open until the client
says otherwise — so the bound is not a nicety, it is the difference between a rolling deploy and a stuck pod.

## 10. Typed clients

```ts
export type GrpcClient<S extends GrpcServiceDef> = {
  readonly [M in keyof S]: GrpcCaller<S[M]>;
} & {
  close(): void;
  [Symbol.dispose](): void;
};

export declare function createGrpcClient<S extends GrpcServiceDef>(opts: GrpcClientOptions<S>): GrpcClient<S>;

export interface GrpcClientOptions<S extends GrpcServiceDef> {
  readonly definition: GrpcLoadedService<S>;
  readonly address: string;
  readonly credentials: 'insecure' | GrpcClientTlsOptions;
  readonly deadlineMs: number;
  readonly validateMetadata: (metadata: GrpcMetadata) => GrpcMetadata;
}
```

`#556` DoD 5 requires typed clients. The same mapped type, from the same declaration, so a client and a server built from one `type Orders` cannot disagree — which is the property protobuf's
generators provide by generating both, achieved here by not generating either.

`deadlineMs` is required, for `../SPEC.md` §7's reason. A `GrpcCaller` accepts a per-call override so `remainingMs()` (§6) can be threaded through, and that override is the propagation mechanism
rather than a convenience.

`credentials` is required here too. A client defaulting to insecure is worse than a server doing it, because the server at least fails visibly when a TLS client connects.

`protoDecode<T>` establishes the supported protobuf wire shape, not every validation constraint on `T`. The binding must make request and response validation explicit when bounds, patterns or other
application rules are part of the service contract.

## 11. The boundary with the protobuf epic, stated as a dependency

`#557` step 9 asks for this boundary. It runs exactly here:

| Build-time type/codec layer (`@zmdb/aot-validator`, `@zmdb/schema-core`) | Runtime web layer (`@zmdb/web/microservices/grpc`)   |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `ProtoField<N>`, `Proto<K>` and their IR carriage                        | `GrpcServiceDef`, `GrpcMethodDef` public types       |
| `protoEncode`, `protoDecode`, `protoDescriptor`                          | `bindGrpcService`, `GrpcHandlers`                    |
| `grpcDescriptor`, `loadGrpcService`                                      | server/client adapters and application lifecycle     |
| field-number, wire-type and method-shape diagnostics                     | deadlines, cancellation, metadata and status mapping |

There is **one** `TypeIR` walker and it is not in `@zmdb/web`. The gRPC-owned `grpcDescriptor` implementation is on the emitter side despite being a gRPC concept, because putting it here would mean a
second walker over the same IR, and two walkers that disagree about a field number is a wire break neither codebase's tests can see.

The complete path now ships: one reflection walk emits the descriptor, validators and codecs, and the web adapter turns that artifact into grpc-js service definitions and typed client calls without
parsing the descriptor.

Everything else in this epic — `TransportStrategy`, the dispatcher, the broker strategies, the hybrid lifecycle — is genuinely independent, so the epic's claim holds for six of its seven sub-issues.

## 12. Acceptance evidence

1. `a service with an unimplemented method does not compile` — type-test on `GrpcHandlers`, the property the decorator was refused for (§4).
2. `a unary handler where a server stream is declared does not compile` — type-test, and the reverse.
3. `a handler whose request type does not match the declaration does not compile` — type-test.
4. `declaring a service as an interface does not compile` — type-test naming `TS2344`, because this is the error a user will hit and §4's paragraph is the only place it is explained.
5. `all four call types round-trip` — one test per call type against an in-process server, which is what makes `#556` DoD 5 assertable without a second language.
6. `a cancelled stream aborts call.signal and runs the handler's finally` — the cancellation path, asserted through the `finally` and not just through the abort.
7. `remainingMs decreases and reaches zero at the deadline` — §6, with a settable clock.
8. `an outbound call inside a handler receives the remaining budget, not a fresh one` — §6, the assertion that pins propagation. Without it the feature is a field nobody reads.
9. `a call with no deadline is served and remainingMs is Infinity` — §6.
10. `a thrown GrpcError sends its status and details` — §8.
11. `any other thrown value sends INTERNAL with a fixed string and the real error reaches onError` — §8, both halves, because the leak is the half that matters.
12. `a malformed frame is INVALID_ARGUMENT, not INTERNAL` — §8.
13. `binary metadata arrives as Uint8Array on binaryHeaders and never on headers` — §7.
14. `setTrailer after the first yield is delivered` — §7, the case that distinguishes a trailer from a header.
15. `one authorisation function written against WithHeaders is callable with a GrpcCall` — §7, the fourth context in `../SPEC.md` §3.1's list.
16. `a failed bind rejects init and closes what was already opened` — §9, shared with `../SPEC.md` §10.
17. `shutdown force-closes after graceMs with a stream still open` — §9, the assertion that a bounded shutdown actually is bounded.

## Non-goals (rejected)

- **No runtime `.proto` parsing and no adapter import of `@grpc/proto-loader`.** §3 — startup I/O, a second grammar implementation, and an untyped result that would need a cast per message.
- **No `.proto` as an input at all.** §2 — `protoDescriptor` is frozen as output; two schema sources is the problem the project's design exists to avoid.
- **No `.proto`-to-`.d.ts` generator in this epic.** §2 — a real need, a separate tool, and no runtime surface.
- **No `@GrpcMethod` or `@GrpcStreamMethod` decorator.** §4 — a decorated class with a missing method compiles, and `UNIMPLEMENTED` at the caller is worse than a missing-property type error at the
  handler.
- **No `requestStream: boolean`.** §4 — under `exactOptionalPropertyTypes`, `false` and absent mean the same thing, so the option is two spellings of one fact.
- **No gRPC as a `TransportStrategy`.** §1 — `RawMessage` would erase the method, the per-direction types and the streaming flags, which the gRPC layer would then re-derive.
- **No `Settlement`, redelivery, or dead-lettering.** §1 — the caller is still there; a failed call is the caller's to retry.
- **No framework-side retry or backoff.** §1 — a client that retries a non-idempotent unary call twice is worse than a client that reports a failure once.
- **No default `credentials`.** §9 — an insecure default is how plaintext reaches production; `'insecure'` is a word you can grep for in review.
- **No unbounded `tryShutdown`.** §9 — a bidirectional stream is open until the client says otherwise.
- **No `setHeader` on `GrpcCall`.** §7 — response metadata is already gone by the second message, so the API would document a mistake it could instead make unwritable.
- **No `Buffer` on the public surface.** §7 — public binary data and generated codecs use `Uint8Array`; only the private grpc-js serializer boundary performs the required Node conversion.
- **No gRPC-Web or grpc-gateway transcoding.** Both are HTTP/1 shims over this surface, and the project already has a first-class HTTP surface with an OpenAPI document — which is the better answer to
  "a browser needs to call this" than a translation layer that supports a subset of the call types.
- **No reflection service, no health service, no channelz.** Each is a separate standard service to implement and none is needed to satisfy `#556` DoD 5; a descriptor committed to the repository is a
  better contract artifact than a reflection endpoint, because it can be diffed before it ships.
- **No numeric status enum.** §8 — the wire numbers stay in the adapter.
