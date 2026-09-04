import type { Equal, Expect, ExpectNot, Extends } from '@zmdb/schema-core';
// The type-level half of the gRPC tests freeze (#556 / spec freeze #557). Frozen text: `./SPEC.md`
// §4, §5, §7, §8, §9 and §10; its own list of what to assert is §12, whose items 1, 2, 3, 4 and 15
// are named there as type-tests. Compiled by `node scripts/typecheck.mjs`; never executed.
//
// The parent microservices module now ships. The gRPC subpath remains unresolved:
// TS2307 is reported at the wrapped import's module specifier, and `typeof` on a
// name from that unresolved module is the compiler's *error type* rather than
// `any` — identical to everything, so a `typeof`-based `Equal` is vacuously true
// today and is written green, with no directive, arming itself when gRPC lands.
//
// This file does one thing that one does not. Four of §12's five type-test items are claims about how
// TypeScript behaves — that an unimplemented method, a mismatched stream flag, a wrong request type
// and an `interface` service declaration each fail to compile — and those are checkable *today*,
// against the local transcription, because they are properties of mapped and conditional types rather
// than of code this repo has yet to write. So each appears twice: once green, against the
// transcription, which verifies §4 and §5 are telling the truth about the compiler; and once red,
// against the export, which freezes that the shipped type has the property. The green half is where
// the value is — it is what caught §4's error code being wrong (see the tests-freeze notes).

import type { AppOptions, DispatcherOptions, TransportStrategy, WithHeaders } from '../index.js';
import type {
  GrpcBinding,
  GrpcCall,
  GrpcClientOptions,
  GrpcError,
  GrpcFailure,
  GrpcHandler,
  GrpcHandlers,
  GrpcMethodDef,
  GrpcServerOptions,
  GrpcServiceDef,
  GrpcServiceSpec,
  GrpcStatus,
  bindGrpcService,
  createGrpcClient,
  // @ts-expect-error TS2307: the ./microservices/grpc module does not exist yet.
} from './index.js';

// ---------------------------------------------------------------------------
// The frozen shapes, transcribed from the spec's own code blocks
// ---------------------------------------------------------------------------

interface FrozenGrpcMethodDef {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
}

type FrozenGrpcServiceDef = { readonly [method: string]: FrozenGrpcMethodDef };

interface FrozenGrpcCall<T> {
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

type FrozenGrpcHandler<D extends FrozenGrpcMethodDef> = D extends { requestStream: true }
  ? D extends { responseStream: true }
    ? (call: FrozenGrpcCall<AsyncIterable<D['request']>>) => AsyncIterable<D['response']>
    : (call: FrozenGrpcCall<AsyncIterable<D['request']>>) => Promise<D['response']>
  : D extends { responseStream: true }
    ? (call: FrozenGrpcCall<D['request']>) => AsyncIterable<D['response']>
    : (call: FrozenGrpcCall<D['request']>) => Promise<D['response']>;

type FrozenGrpcHandlers<S extends FrozenGrpcServiceDef> = { readonly [M in keyof S]: FrozenGrpcHandler<S[M]> };

type FrozenGrpcStatus =
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

interface FrozenGrpcFailure {
  readonly service: string;
  readonly method: string;
  readonly status: GrpcStatus;
  readonly error: unknown;
}

interface FrozenGrpcBinding {
  readonly service: string;
  readonly methods: readonly string[];
}

// §4 verbatim, except for the underscore. The type parameter is *unused* in §4's declaration — none of
// `name`, `descriptor` or `onError` mentions `S` — and `eslint/no-unused-vars` is an error in
// `.oxlintrc.json`, so transcribing the frozen text literally fails this repo's own lint gate. The
// underscore is oxlint's prescribed escape ("Unused variables should start with a '_'"), and having to
// reach for it here is the evidence: reported in the tests-freeze notes, because a public type whose
// parameter has to be spelled `_S` is not a shape to ship.
interface FrozenGrpcServiceSpec<_S extends GrpcServiceDef> {
  readonly name: string;
  readonly descriptor: string;
  readonly onError: (failure: GrpcFailure) => void;
}

// The two fields §8 puts on `GrpcError`. Transcribed as a plain shape rather than a class, because a
// class declaration here would be a second `GrpcError` for a reader to confuse with the real one.
interface FrozenGrpcErrorFields {
  readonly status: GrpcStatus;
  readonly details: string;
}

// §4's own example service, verbatim — inner members are not `readonly` there, which is what a user
// writes and which `GrpcMethodDef`'s `readonly` members accept.
interface GetOrder {
  readonly id: string;
}
interface Order {
  readonly id: string;
  readonly total: number;
}
interface Chunk {
  readonly bytes: Uint8Array;
}
interface UploadAck {
  readonly received: number;
}

type GetDef = { request: GetOrder; response: Order };
type UploadDef = { request: Chunk; response: UploadAck; requestStream: true };
type WatchDef = { request: GetOrder; response: Order; responseStream: true };
type ChatDef = { request: Order; response: Order; requestStream: true; responseStream: true };

type Orders = {
  readonly get: GetDef;
  readonly upload: UploadDef;
  readonly watch: WatchDef;
  readonly chat: ChatDef;
};

// ---------------------------------------------------------------------------
// §4: the declaration types
// ---------------------------------------------------------------------------

// §4: "**`requestStream` and `responseStream` are `?: true`, never `boolean`.**" Under
// `exactOptionalPropertyTypes` a `?: false` member "is a value nobody can usefully write", and `Equal`
// against `?: true` is what rejects a slice that spells them `boolean` for symmetry.
// @ts-expect-error TS2344
export type MethodDefShape = Expect<Equal<GrpcMethodDef, FrozenGrpcMethodDef>>;

// @ts-expect-error TS2344
export type ServiceDefShape = Expect<Equal<GrpcServiceDef, FrozenGrpcServiceDef>>;

// ---------------------------------------------------------------------------
// §5: the four call types, one conditional type
// ---------------------------------------------------------------------------
//
// The four green assertions verify that §5's conditional really produces §5's table — a wrong
// conditional in a frozen spec is a defect worth catching before an implementation copies it. The
// four red ones freeze that the shipped `GrpcHandler` is that conditional.

type UnaryHandler = (call: FrozenGrpcCall<GetOrder>) => Promise<Order>;
type ClientStreamHandler = (call: FrozenGrpcCall<AsyncIterable<Chunk>>) => Promise<UploadAck>;
type ServerStreamHandler = (call: FrozenGrpcCall<GetOrder>) => AsyncIterable<Order>;
type BidiHandler = (call: FrozenGrpcCall<AsyncIterable<Order>>) => AsyncIterable<Order>;

export type UnaryRow = Expect<Equal<FrozenGrpcHandler<GetDef>, UnaryHandler>>;
export type ClientStreamRow = Expect<Equal<FrozenGrpcHandler<UploadDef>, ClientStreamHandler>>;
export type ServerStreamRow = Expect<Equal<FrozenGrpcHandler<WatchDef>, ServerStreamHandler>>;
export type BidiRow = Expect<Equal<FrozenGrpcHandler<ChatDef>, BidiHandler>>;

// @ts-expect-error TS2344
export type UnaryHandlerIsFrozen = Expect<Equal<GrpcHandler<GetDef>, FrozenGrpcHandler<GetDef>>>;

// @ts-expect-error TS2344
export type ClientStreamHandlerIsFrozen = Expect<Equal<GrpcHandler<UploadDef>, FrozenGrpcHandler<UploadDef>>>;

// @ts-expect-error TS2344
export type ServerStreamHandlerIsFrozen = Expect<Equal<GrpcHandler<WatchDef>, FrozenGrpcHandler<WatchDef>>>;

// @ts-expect-error TS2344
export type BidiHandlerIsFrozen = Expect<Equal<GrpcHandler<ChatDef>, FrozenGrpcHandler<ChatDef>>>;

// §12.2, both directions. §5: "A unary function where a server stream is declared is `TS2741` —
// 'Property '[Symbol.asyncIterator]' is missing in type 'Promise<Order>''". Carried positively as a
// non-assignability, per the convention's rule that the idiom cannot pre-assert an error.
export type UnaryWhereStreamDeclaredIsRejected = ExpectNot<Extends<UnaryHandler, ServerStreamHandler>>;
export type StreamWhereUnaryDeclaredIsRejected = ExpectNot<Extends<ServerStreamHandler, UnaryHandler>>;

// @ts-expect-error TS2344
export type UnaryWhereStreamDeclaredIsRejectedOnExport = ExpectNot<Extends<UnaryHandler, GrpcHandler<WatchDef>>>;

// @ts-expect-error TS2344
export type StreamWhereUnaryDeclaredIsRejectedOnExport = ExpectNot<Extends<ServerStreamHandler, GrpcHandler<GetDef>>>;

// §12.3: a handler whose request type does not match the declaration. `Chunk` and `GetOrder` share no
// member, so the mismatch is in the `payload` the handler reads and nowhere else.
type WrongRequestHandler = (call: FrozenGrpcCall<Chunk>) => Promise<Order>;

export type WrongRequestTypeIsRejected = ExpectNot<Extends<WrongRequestHandler, UnaryHandler>>;

// @ts-expect-error TS2344
export type WrongRequestTypeIsRejectedOnExport = ExpectNot<Extends<WrongRequestHandler, GrpcHandler<GetDef>>>;

// §12.1, "the property the decorator was refused for": a service with an unimplemented method must
// not compile. `chat` is omitted.
//
// §4 says this is "`TS2739` naming the three missing methods, verified against the compiler rather
// than assumed". It is not: omitting one method of four is **TS2741** — "Property 'chat' is missing in
// type '{ get: …; upload: …; watch: … }' but required in type 'GrpcHandlers<Orders>'" — and TS2739
// needs two or more missing, which a second probe confirmed ("missing the following properties …:
// watch, chat"). The property §4 wants is real; the error code and the count in that sentence are
// wrong, and the tests-freeze notes carry the correction. Nothing here asserts a code, because the
// idiom cannot: `ExpectNot<Extends<…>>` is the positive form of "does not compile".
type PartialHandlers = {
  readonly get: UnaryHandler;
  readonly upload: ClientStreamHandler;
  readonly watch: ServerStreamHandler;
};

export type UnimplementedMethodIsRejected = ExpectNot<Extends<PartialHandlers, FrozenGrpcHandlers<Orders>>>;

// @ts-expect-error TS2344
export type UnimplementedMethodIsRejectedOnExport = ExpectNot<Extends<PartialHandlers, GrpcHandlers<Orders>>>;

// A complete map *is* accepted — green, and it is what stops the assertion above from coming true by
// `FrozenGrpcHandlers<Orders>` degenerating to something nothing satisfies. Exhaustiveness that
// rejects the correct map too is not exhaustiveness.
type CompleteHandlers = PartialHandlers & { readonly chat: BidiHandler };

export type CompleteHandlerMapIsAccepted = Expect<Extends<CompleteHandlers, FrozenGrpcHandlers<Orders>>>;

// ---------------------------------------------------------------------------
// §12.4: declaring a service as an `interface` does not compile
// ---------------------------------------------------------------------------
//
// The one item in either §12 that is a claim about the compiler and about nothing this repo will ever
// write, so it is asserted against the transcription and stays there. §4: "An `interface` has no
// implicit index signature, so `GrpcHandlers<OrdersInterface>` fails with `TS2344` — 'Index signature
// for type 'string' is missing'." Verified: that is the message, character for character.
//
// This assertion never self-retires, because what it pins is TypeScript's behaviour rather than a
// zmdb type. It goes red if a future TypeScript gives interfaces implicit index signatures, which is
// exactly when §4's paragraph would need rewriting.

interface OrdersIface {
  readonly get: GetDef;
  readonly upload: UploadDef;
  readonly watch: WatchDef;
  readonly chat: ChatDef;
}

// @ts-expect-error TS2344: Index signature for type 'string' is missing in type 'OrdersIface'.
export type InterfaceServiceIsRejected = FrozenGrpcHandlers<OrdersIface>;

// §4: "Adding `extends GrpcServiceDef` to fix that makes it worse: the inherited index signature
// appears in `keyof`, so the mapped type acquires a `string` member whose handler type is
// `(call: GrpcCall<unknown>) => Promise<unknown>`, and every correct method now fails against it."
// Verified: the failure is a TS2322 whose target is that exact signature. Carried positively — the
// complete, correct handler map is *not* assignable, which is the whole of "makes it worse".
interface OrdersIfaceExt extends FrozenGrpcServiceDef {
  readonly get: GetDef;
  readonly upload: UploadDef;
  readonly watch: WatchDef;
  readonly chat: ChatDef;
}

export type ExtendsServiceDefIsWorse = ExpectNot<Extends<CompleteHandlers, FrozenGrpcHandlers<OrdersIfaceExt>>>;

// ---------------------------------------------------------------------------
// §7: metadata, trailers, and the member that is not there
// ---------------------------------------------------------------------------

// `Equal` on the whole interface, so the absent `setHeader` is pinned by its absence. §7: "There is
// no `setHeader`: response metadata is sent when the first message is, and a handler that 'set a
// header' after its first `yield` would be silently ignored." An added `setHeader` fails here.
//
// `binaryHeaders: Readonly<Record<string, Uint8Array>>` rides along, which is §7's other decision —
// `Uint8Array` and not `Buffer`, matching `.oxlintrc.json`'s banned global.
// @ts-expect-error TS2344
export type CallShape = Expect<Equal<GrpcCall<number>, FrozenGrpcCall<number>>>;

// §12.15 / §7: "a `GrpcCall` satisfies `WithHeaders` (`../SPEC.md` §3.1) and one authorisation
// function serves HTTP, GraphQL, messages and gRPC". Green against the transcription, which is the
// half checkable today; the runtime half is `./grpc.spec.ts`.
type FrozenWithHeaders = { readonly headers: Readonly<Record<string, string>> };

export type FrozenCallSatisfiesWithHeaders = Expect<Extends<FrozenGrpcCall<number>, FrozenWithHeaders>>;
export type CallSatisfiesWithHeaders = Expect<Extends<GrpcCall<number>, WithHeaders>>;

// §7 rejected folding binary metadata into `headers` base64-encoded. Carried as the claim that the
// two maps have different value types, so a slice that made both `string` fails.
type FrozenBinaryHeaders = Readonly<Record<string, Uint8Array>>;

// @ts-expect-error TS2344
export type BinaryHeadersAreBytes = Expect<Equal<GrpcCall<number>['binaryHeaders'], FrozenBinaryHeaders>>;

// ---------------------------------------------------------------------------
// §8: errors
// ---------------------------------------------------------------------------

// Thirteen arms, `Equal` so a fourteenth or a numeric `enum` fails. §8: "A literal union rather than a
// numeric `enum`: the wire values are gRPC's and the adapter maps to them in one place."
// @ts-expect-error TS2344
export type StatusShape = Expect<Equal<GrpcStatus, FrozenGrpcStatus>>;

// @ts-expect-error TS2344
export type FailureShape = Expect<Equal<GrpcFailure, FrozenGrpcFailure>>;

// Green (see the header): `GrpcError` is a class, and its two fields are what §8 freezes — `details`
// "sent to the caller — must be safe to disclose", which is the whole reason it is separate from
// `Error.message`.
export type ErrorCarriesStatusAndDetails = Expect<Extends<GrpcError, FrozenGrpcErrorFields>>;

// ---------------------------------------------------------------------------
// §4, §9, §10: the binding, the server and the client
// ---------------------------------------------------------------------------

// @ts-expect-error TS2344
export type BindingShape = Expect<Equal<GrpcBinding, FrozenGrpcBinding>>;

// §8: "`onError` is required on `GrpcServiceSpec`" — `Equal` against a transcription with no `?` is
// what pins that.
// @ts-expect-error TS2344
export type ServiceSpecShape = Expect<Equal<GrpcServiceSpec<Orders>, FrozenGrpcServiceSpec<Orders>>>;

// Green, checked today, and it is a defect made mechanical rather than a property being celebrated:
// because §4's `GrpcServiceSpec<S>` uses `S` nowhere, a spec for one service and a spec for a
// completely different one are *the same type*. That matters at `bindGrpcService`, whose `S` then has
// only two places to come from — the annotation on the spec value, or the constraint. Probed both:
// with `const spec: GrpcServiceSpec<Orders>` a three-method handler map is correctly rejected
// (TS2741), and with the spec object written inline and unannotated `S` falls back to
// `GrpcServiceDef` and every handler fails against `(call: GrpcCall<unknown>) => Promise<unknown>` —
// the very "error naming a type the user did not write" that §4 claims this shape avoids.
//
// This assertion goes red the day `GrpcServiceSpec` gains a member that mentions `S`, which is the
// fix the tests-freeze notes recommend.
type PingService = { readonly ping: GetDef };

export type ServiceSpecIgnoresItsTypeParameter = Expect<
  Equal<FrozenGrpcServiceSpec<Orders>, FrozenGrpcServiceSpec<PingService>>
>;

// §9: `credentials` is "**required and has no default.**" `GrpcTlsOptions` is named in §9 and §10 but
// never declared anywhere in either spec file, so the union's second arm cannot be transcribed and
// `Equal` on the whole of `GrpcServerOptions` is not writable. Required-ness is asserted instead, in
// the form that does not need the arm: `undefined` must not be assignable to it.
// @ts-expect-error TS2344
export type CredentialsIsRequired = ExpectNot<Extends<undefined, GrpcServerOptions['credentials']>>;

// @ts-expect-error TS2344
export type ServerAddressIsRequired = Expect<Equal<GrpcServerOptions['address'], string>>;

// @ts-expect-error TS2344
export type ServerBindingsAreRequired = Expect<Equal<GrpcServerOptions['bindings'], readonly GrpcBinding[]>>;

// §10: "`deadlineMs` is required, for `../SPEC.md` §7's reason." Carried positively, so this is false
// for `number | undefined` too.
// @ts-expect-error TS2344
export type DeadlineMsIsRequired = Expect<Equal<GrpcClientOptions<Orders>['deadlineMs'], number>>;

// @ts-expect-error TS2344
export type ClientCredentialsIsRequired = ExpectNot<Extends<undefined, GrpcClientOptions<Orders>['credentials']>>;

// Green (see the header). `bindGrpcService` takes the spec and a *total* handler map, which is where
// §12.1's exhaustiveness is actually enforced at a call site.
type FrozenBindGrpcService = <S extends GrpcServiceDef>(
  service: GrpcServiceSpec<S>,
  handlers: GrpcHandlers<S>,
) => GrpcBinding;

export type BindSignature = Expect<Equal<typeof bindGrpcService, FrozenBindGrpcService>>;

// `GrpcClient` and its `GrpcCaller<S[M]>` member cannot be transcribed: §10 uses `GrpcCaller` in the
// mapped type and describes it in prose ("accepts a per-call override") but never declares it. So the
// client is pinned only through `createGrpcClient`'s parameter, which is declared. Recorded in the
// tests-freeze notes as a gap in the frozen text, not as an omission here.
export type CreateClientTakesOptionsOnly = Expect<Equal<Parameters<typeof createGrpcClient>['length'], 1>>;

// ---------------------------------------------------------------------------
// §9: the member `AppOptions` gains, and the complete shape
// ---------------------------------------------------------------------------

// #559 makes AppOptions real before #561 adds the gRPC server. Keep this red
// against the key set without pretending the absent property can be indexed.
// @ts-expect-error TS2344: `grpc` remains absent until the gRPC implementation lands.
export type AppOptionsGainsGrpc = Expect<Equal<Extract<keyof AppOptions, 'grpc'>, 'grpc'>>;

// The whole-shape assertion, here rather than in `../microservices.type-test.ts`, because this is the
// only file with both halves in scope: `../SPEC.md` §10 declares three members and §9 of this file
// adds the fourth, so neither spec states the complete type on its own.
interface FrozenAppOptions {
  readonly transports?: readonly TransportStrategy[];
  readonly dispatcher?: DispatcherOptions;
  readonly graceMs?: number;
  readonly grpc?: GrpcServerOptions;
}

// @ts-expect-error TS2344
export type AppOptionsShape = Expect<Equal<AppOptions, FrozenAppOptions>>;
