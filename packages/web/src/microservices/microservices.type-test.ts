import type { Equal, Expect, ExpectNot, Extends } from '@zmdb/schema-core';

import type { createApp } from '../app/index.js';
import type { Ctx, QueryValues } from '../context/index.js';
import type { Guard } from '../middleware/index.js';
// The type-level half of the tests freeze for microservice transports (#556 / spec freeze #557).
// Frozen text: `./SPEC.md` §2, §2.4, §3, §3.1, §3.3, §4, §5, §7, §8 and §10; its own list of what to
// assert is §12, whose items 1, 2 and 15 are named there as type-tests.
//
// Compiled by `node scripts/typecheck.mjs`, which is a gate; never executed — `vitest.config.ts`
// includes only `*.spec.ts`. The idiom is `@ts-expect-error` over `Expect<Equal<…, frozen shape>>`,
// which is self-retiring: the day a claim comes true its directive becomes an unused-directive error
// (TS2578, an error here) and this file has to be edited, so no assertion outlives what it froze.
//
// ---------------------------------------------------------------------------
// Why the whole module is imported behind one directive
// ---------------------------------------------------------------------------
//
// `./index.ts` does not exist — `packages/web/src/microservices/` holds two `SPEC.md` files and no
// code — so the import below is a TS2307 and every name it binds is an error type. That is the
// two-directive case the convention describes for a missing named export, one level up: one directive
// absorbs the TS2307, and each `Expect<Equal<…>>` needs its own because `Equal<any, Frozen>` is
// `false`. The directive sits *inside* the braces because TS2307 is reported at the module specifier,
// which for a wrapped import is the last line — the convention's rule that the directive goes on the
// line the compiler reports, in its least obvious form.
//
// ---------------------------------------------------------------------------
// One thing probing changed, and it is worth reading before editing this file
// ---------------------------------------------------------------------------
//
// A name imported from an unresolved module is not uniformly `any`. Used as a type it behaves as
// `any`, so `Equal<Settlement, FrozenSettlement>` is `false` and needs a directive. Resolved through
// the value namespace by `typeof`, it is the compiler's *error type* instead, and the error type is
// identical to everything — so `Equal<typeof createMessageClient, FrozenCreateMessageClient>` is
// vacuously **true** today. Every `typeof`-based assertion below is therefore written green, with no
// directive.
//
// Measured, not reasoned about: the first draft of this file carried directives on those five
// assertions and `node scripts/typecheck.mjs` reported TS2578 "Unused '@ts-expect-error' directive"
// on each of them and nothing else. That is what a green assertion is worth here — it cannot fail
// today, it arms itself the moment the module lands, and it carries no directive to go stale.
import type {
  AppOptions,
  ClientPatterns,
  DispatcherOptions,
  EventPattern,
  MessageClient,
  MessageClientOptions,
  MessageContext,
  MessageDispatcher,
  MessageGuard,
  MessagePattern,
  RawMessage,
  ResolvedMessagePattern,
  Settlement,
  TransportCapabilities,
  TransportStrategy,
  WithHeaders,
  createMessageClient,
  createMessageDispatcher,
  getMessagePatterns,
  // @ts-expect-error TS2307: the ./microservices module does not exist yet. One import statement,
  // because oxlint's `import/no-duplicates` allows only one per specifier.
} from './index.js';

// ---------------------------------------------------------------------------
// The frozen shapes, transcribed from the spec's own code blocks
// ---------------------------------------------------------------------------

type FrozenSettlement =
  | { readonly kind: 'ack' }
  | { readonly kind: 'retry'; readonly afterMs: number }
  | { readonly kind: 'dead'; readonly reason: string };

interface FrozenRawMessage {
  readonly pattern: string;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string | undefined;
  readonly replyTo: string | undefined;
  readonly deliveryAttempt: number;
}

interface FrozenTransportCapabilities {
  readonly redelivery: boolean;
  readonly deadLetter: boolean;
  readonly requestResponse: boolean;
}

interface FrozenTransportStrategy {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  listen(dispatch: (message: RawMessage) => Promise<Settlement>): Promise<void>;
  send(pattern: string, payload: unknown, timeoutMs: number): Promise<unknown>;
  emit(pattern: string, payload: unknown): Promise<void>;
  close(graceMs: number): Promise<void>;
}

interface FrozenMessageContext<T> {
  readonly kind: 'message';
  readonly pattern: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string;
  readonly deliveryAttempt: number;
  readonly transport: string;
}

type FrozenWithHeaders = { readonly headers: Readonly<Record<string, string>> };

interface FrozenMessageGuard {
  canActivate(ctx: MessageContext<unknown>): boolean | Promise<boolean>;
}

interface FrozenResolvedMessagePattern {
  readonly pattern: string;
  readonly handlerName: string;
  readonly semantics: 'request' | 'event';
}

interface FrozenDispatcherOptions {
  readonly onUnhandled: (message: RawMessage) => void;
  readonly onInvalidPayload: (message: RawMessage, error: unknown) => void;
  readonly onHandlerError: (message: RawMessage, error: unknown) => void;
  readonly onUndeliverable?: (message: RawMessage, settlement: Settlement) => void;
  readonly maxAttempts?: number;
  readonly retryAfterMs?: (attempt: number) => number;
}

interface FrozenMessageDispatcher {
  dispatch(message: RawMessage): Promise<Settlement>;
  readonly patterns: readonly string[];
}

// Two payload types, one a strict subset of the other, used for the validator-mismatch and
// client-map assertions. Nothing about them is frozen; they are the smallest pair that makes
// contravariance visible.
interface Sku {
  readonly sku: string;
}
interface Placed {
  readonly id: string;
  readonly sku: string;
}

// ---------------------------------------------------------------------------
// §2: the strategy interface
// ---------------------------------------------------------------------------
//
// §2.2's "`requeue` is not one of them" and "`retry` therefore always carries `afterMs`, with no
// default" are both carried by this one `Equal`: a fourth arm, or an optional `afterMs`, makes it
// false. `Equal` and not `Extends` for exactly that reason — `Extends` would accept a `Settlement`
// that had grown a `requeue` arm.

// @ts-expect-error TS2344: `Settlement` does not exist yet, so `Equal` is false.
export type SettlementHasThreeArms = Expect<Equal<Settlement, FrozenSettlement>>;

// §2: `payload` is "parsed, NOT validated", which is what `unknown` says; and `correlationId` is
// `string | undefined` here against `string` on `MessageContext` (§3), which is the whole of the
// dispatcher-generates-one rule expressed as a type difference.
// @ts-expect-error TS2344
export type RawMessageShape = Expect<Equal<RawMessage, FrozenRawMessage>>;

// @ts-expect-error TS2344
export type CapabilitiesShape = Expect<Equal<TransportCapabilities, FrozenTransportCapabilities>>;

// §2.1 is the load-bearing one: the settlement is the callback's *return value*, not an `ack()`
// method on the message. An implementation that put `ack`/`nack` on `RawMessage` and typed `listen`
// as `(message: RawMessage) => Promise<void>` fails here and nowhere else in the freeze.
//
// §2.5's required `graceMs` and §2.6's absent `connect`/`unsubscribe`/`pause`/`resume` ride along,
// because `Equal` on a whole interface rejects both an extra member and an optional parameter.
// @ts-expect-error TS2344
export type StrategyShape = Expect<Equal<TransportStrategy, FrozenTransportStrategy>>;

// ---------------------------------------------------------------------------
// §3, §3.1, §3.3 and §12.15: the context is a sibling, not a subtype
// ---------------------------------------------------------------------------

// Read off the real `Guard` rather than restated, so widening `Guard.canActivate` — the convenience
// §1 calls a security hole ("an authorisation check that was protecting a route stops protecting
// anything and nothing fails") — breaks this file at compile time instead of quietly making the two
// non-assignability claims below true.
type GuardCtx = Parameters<Guard['canActivate']>[0];

// Green, and the anchor the rest of this section rests on: it fails the moment `Guard` stops taking a
// `Ctx`, which is what stops `GuardCtx` degenerating and making the claims below vacuous.
export type GuardTakesACtx = Expect<Equal<GuardCtx, Ctx<Record<string, string>, unknown, QueryValues>>>;

// @ts-expect-error TS2344
export type MessageContextShape = Expect<Equal<MessageContext<number>, FrozenMessageContext<number>>>;

type AnyMessageContext = MessageContext<unknown>;

// §12.15, first half. `ExpectNot` rather than a directive over an illegal assignment, because the
// convention's limit applies: the idiom cannot pre-assert that a currently-legal thing becomes
// illegal, so the claim is carried positively, as a `false`.
// @ts-expect-error TS2344
export type MessageContextIsNotACtx = ExpectNot<Extends<AnyMessageContext, GuardCtx>>;

// §12.15, second half. Both directions are needed: one alone is satisfied by a `MessageContext` that
// merely adds members to `Ctx`, which is exactly the shape §1 refuses.
// @ts-expect-error TS2344
export type CtxIsNotAMessageContext = ExpectNot<Extends<GuardCtx, AnyMessageContext>>;

// §3.1: "`Ctx` … declares `readonly headers: Readonly<Record<string, string>>` — the same type,
// character for character", so it satisfies `WithHeaders` with no declaration on it. Asserted against
// the local transcription too, because this is the one §3.1 fact that is checkable today: it is a
// claim about shipped `Ctx`, not about the module that does not exist.
export type CtxSatisfiesWithHeadersToday = Expect<Extends<GuardCtx, FrozenWithHeaders>>;

// @ts-expect-error TS2344
export type WithHeadersShape = Expect<Equal<WithHeaders, FrozenWithHeaders>>;

// §3.1 also requires `WithHeaders` to be a `type` and not an `interface`, "because nothing should be
// able to `implements WithHeaders`". An interface with the same single member is `Equal` to the
// alias, so that half is not assertable at all; it is in the tests-freeze notes rather than left
// looking covered by the assertion above.

// §3.3: a separate interface, taking a `MessageContext` and not a `Ctx`.
// @ts-expect-error TS2344
export type MessageGuardShape = Expect<Equal<MessageGuard, FrozenMessageGuard>>;

// The pair that makes §3.3 mean something: neither guard interface can stand in for the other, so
// the literal "one guard serves both" reading of #556 DoD 2 stays refused rather than drifting back.
// @ts-expect-error TS2344
export type MessageGuardIsNotAGuard = ExpectNot<Extends<MessageGuard, Guard>>;

// @ts-expect-error TS2344
export type GuardIsNotAMessageGuard = ExpectNot<Extends<Guard, MessageGuard>>;

// ---------------------------------------------------------------------------
// §4 and §12.1, §12.2: the decorators, and the two compile errors they buy
// ---------------------------------------------------------------------------
//
// `ClassMethodDecoratorContext`, not `MethodDecorator`: §4 records that the legacy decorator type
// "does not apply under Stage 3 (`experimentalDecorators` is `false`)" and that #557's API surface
// named it anyway. Pinning the whole signature is what catches a slice that reaches for it again.

type FrozenMessagePattern = <T, R>(
  pattern: string,
  validate: (raw: unknown) => T,
) => (target: (ctx: MessageContext<T>) => R | Promise<R>, context: ClassMethodDecoratorContext) => void;

type FrozenEventPattern = <T>(
  pattern: string,
  validate: (raw: unknown) => T,
) => (target: (ctx: MessageContext<T>) => void | Promise<void>, context: ClassMethodDecoratorContext) => void;

// Green because `typeof` on a name from an unresolved module is the error type (see the header), so
// these two cannot fail today. They arm themselves the moment `./index.ts` exists, and they are the
// only assertions that pin §4's `void | Promise<void>` union directly — §4: "the union defeats [the
// void-return special case] in both directions"; `Promise<void>` alone lets the synchronous form
// through, and `Promise<undefined>` rejects a correct handler.
export type MessagePatternSignature = Expect<Equal<typeof MessagePattern, FrozenMessagePattern>>;
export type EventPatternSignature = Expect<Equal<typeof EventPattern, FrozenEventPattern>>;

// The decorators' target parameters, read off the real exports rather than off the transcriptions
// above, so §12.1 and §12.2 are claims about `EventPattern` and `MessagePattern` themselves.
type EventDecoratorTarget<T> = Parameters<ReturnType<typeof EventPattern<T>>>[0];
type MessageDecoratorTarget<T, R> = Parameters<ReturnType<typeof MessagePattern<T, R>>>[0];

type NumberEventTarget = EventDecoratorTarget<number>;
type SyncValueHandler = (ctx: MessageContext<number>) => number;
type AsyncValueHandler = (ctx: MessageContext<number>) => Promise<number>;
type VoidHandler = (ctx: MessageContext<number>) => void;

// §12.1, the synchronous form.
// @ts-expect-error TS2344
export type SyncValueReturnIsRejected = ExpectNot<Extends<SyncValueHandler, NumberEventTarget>>;

// §12.1, the `async` form. §4 says the union is what catches both, and either one without the other
// is precisely the bug the union exists to prevent, so both are asserted.
// @ts-expect-error TS2344
export type AsyncValueReturnIsRejected = ExpectNot<Extends<AsyncValueHandler, NumberEventTarget>>;

// Green — and it is what stops the two above from coming true the wrong way. If
// `EventDecoratorTarget<T>` ever resolves to `never`, both `ExpectNot`s pass, both directives go
// TS2578, and this file goes green while `@EventPattern` accepts nothing at all. A green assertion
// carries no directive, so it goes red the moment that happens instead of hiding it.
export type VoidReturnIsAccepted = Expect<Extends<VoidHandler, NumberEventTarget>>;

// §12.2 / §4 property 2: "`T` is inferred from `validate` in the outer call and fixed before the
// decorated method is checked". A validator producing `Sku` and a handler wanting `Placed` cannot
// meet — contravariance in the `ctx` parameter is what makes it an error rather than a widening.
type PlacedHandler = (ctx: MessageContext<Placed>) => void;
type SkuValidatedTarget = MessageDecoratorTarget<Sku, void>;

// @ts-expect-error TS2344
export type ValidatorOutputIsTheHandlerPayload = ExpectNot<Extends<PlacedHandler, SkuValidatedTarget>>;

// §4's "Nothing scans": the reader takes the class, exactly as `getRoutes` (`../routing/index.ts:106`)
// and `getSubscriptions` (`../gateways/index.ts:59`) do. An implementation that scanned a module or a
// container would need a different parameter, and this is what refuses it.
type FrozenGetMessagePatterns = (cls: abstract new (...args: never[]) => unknown) => readonly ResolvedMessagePattern[];

// @ts-expect-error TS2344
export type ResolvedPatternShape = Expect<Equal<ResolvedMessagePattern, FrozenResolvedMessagePattern>>;

// Green, for the `typeof` reason in the header.
export type GetMessagePatternsSignature = Expect<Equal<typeof getMessagePatterns, FrozenGetMessagePatterns>>;

// ---------------------------------------------------------------------------
// §5: the dispatcher
// ---------------------------------------------------------------------------

// The three sinks are required and `onUndeliverable` is optional *in the type* — §5 is explicit that
// "the type cannot express 'required when a runtime value is false'", which is why the runtime half
// of that rule is `./microservices.spec.ts`'s construction test. `Equal` pins both halves at once: a
// slice that made `onUnhandled` optional to be helpful fails here.
// @ts-expect-error TS2344
export type DispatcherOptionsShape = Expect<Equal<DispatcherOptions, FrozenDispatcherOptions>>;

// `patterns` is exposed deliberately (§5, so "a test can assert every pattern its publishers use is
// present"), and `dispatch` returns the settlement — the §2.1 decision again, one layer up.
// @ts-expect-error TS2344
export type DispatcherShape = Expect<Equal<MessageDispatcher, FrozenMessageDispatcher>>;

type FrozenCreateMessageDispatcher = (consumers: readonly object[], opts: DispatcherOptions) => MessageDispatcher;

// Green, for the `typeof` reason in the header. `readonly object[]` and not a module or a container
// is §5's "built once, from `getMessagePatterns` over each consumer's constructor".
export type CreateDispatcherSignature = Expect<Equal<typeof createMessageDispatcher, FrozenCreateMessageDispatcher>>;

// ---------------------------------------------------------------------------
// §2.4, §7 and §8: the typed client
// ---------------------------------------------------------------------------

type FrozenClientPatterns = {
  readonly [pattern: string]: { readonly request: unknown; readonly response: unknown };
};

type FrozenMessageClient<P extends ClientPatterns> = {
  readonly [K in keyof P]: (payload: P[K]['request']) => Promise<P[K]['response']>;
};

interface FrozenMessageClientOptions<P extends ClientPatterns> {
  readonly timeoutMs: number;
  readonly validate: { readonly [K in keyof P]: (raw: unknown) => P[K]['response'] };
}

// @ts-expect-error TS2344
export type ClientPatternsShape = Expect<Equal<ClientPatterns, FrozenClientPatterns>>;

// Instantiated at a concrete pattern map, because `Equal` on an uninstantiated mapped type compares
// nothing useful.
type OrdersPatterns = { readonly getOrder: { readonly request: Sku; readonly response: Placed } };
type OrdersClient = MessageClient<OrdersPatterns>;
type FrozenOrdersClient = FrozenMessageClient<OrdersPatterns>;
type OrdersClientOptions = MessageClientOptions<OrdersPatterns>;
type FrozenOrdersClientOptions = FrozenMessageClientOptions<OrdersPatterns>;

// §2.4: "`TransportStrategy.send` resolves to `unknown` and the typed surface is a client with
// validators", so the client's own methods are what carry `Promise<P[K]['response']>` and the
// generic-as-assertion shape #557 proposed (`send<Req, Res>`) has nowhere to live.
// @ts-expect-error TS2344
export type MessageClientShape = Expect<Equal<OrdersClient, FrozenOrdersClient>>;

// §7: "`MessageClientOptions.timeoutMs` is **required, with no default**". Carried positively, per
// the convention: `Equal<…, number>` is false for `number | undefined` too, so this pins *required*
// and the type in one assertion — the form that works when the idiom cannot say "omitting this
// property stops compiling".
// @ts-expect-error TS2344
export type TimeoutMsIsRequired = Expect<Equal<OrdersClientOptions['timeoutMs'], number>>;

// §2.4: "`validate` is **total** — a partial map lets the one reply that skipped validation be the
// one that needed it." Totality is a mapped type over `keyof P` with no `?`, which is what this
// checks against the transcription.
// @ts-expect-error TS2344
export type ClientOptionsShape = Expect<Equal<OrdersClientOptions, FrozenOrdersClientOptions>>;

// §8: "there is no parameter for supplying one". Carried as the exact key set, because an added
// `correlationId` option is the specific regression §8 exists to prevent and `Extends` would not see
// it. §8's two reasons — collision on a shared reply channel, and forgery — are both about an id the
// caller chose, so the absence of the parameter is the whole mitigation.
// @ts-expect-error TS2344
export type ClientOptionsHaveNoCorrelationId = Expect<Equal<keyof OrdersClientOptions, 'timeoutMs' | 'validate'>>;

type FrozenCreateMessageClient = <P extends ClientPatterns>(
  transport: TransportStrategy,
  opts: MessageClientOptions<P>,
) => MessageClient<P>;

// Green, for the `typeof` reason in the header.
export type CreateClientSignature = Expect<Equal<typeof createMessageClient, FrozenCreateMessageClient>>;

// ---------------------------------------------------------------------------
// §10: the second parameter on the real `createApp`
// ---------------------------------------------------------------------------

// Pinned member by member, and deliberately not as one `Equal` on the whole interface: §10's code
// block declares three members and `./grpc/SPEC.md` §9 says `AppOptions` "gains
// `readonly grpc?: GrpcServerOptions`", so neither file states the complete type. An
// `Equal<AppOptions, {transports, dispatcher, graceMs}>` here could therefore never come true, its
// directive would stay consumed forever, and nothing would ever report it. The whole-shape assertion
// lives in `./grpc/grpc.type-test.ts`, which is the one file with both halves in scope.
//
// @ts-expect-error TS2344
export type TransportsOption = Expect<Equal<AppOptions['transports'], readonly TransportStrategy[] | undefined>>;

// Green, and for a third reason worth recording: both sides collapse to `any` today —
// `AppOptions['dispatcher']` because `AppOptions` is `any`, and `DispatcherOptions | undefined`
// because `any | undefined` *is* `any` — so `Equal` is vacuously true. Measured: a directive here was
// TS2578. The two neighbours keep theirs because `readonly TransportStrategy[] | undefined` and
// `number | undefined` are not `any`, which is the whole difference.
export type DispatcherOption = Expect<Equal<AppOptions['dispatcher'], DispatcherOptions | undefined>>;

// §10: "default 5_000, passed to close()". The default is a runtime fact, asserted in
// `./microservices.spec.ts`; what the type pins is that the caller may omit it.
// @ts-expect-error TS2344
export type GraceMsOption = Expect<Equal<AppOptions['graceMs'], number | undefined>>;

// The anchored form of the widening `./microservices.spec.ts` uses at runtime. `createApp` is real
// and its parameter tuple has length 1, so indexing at 1 is itself an error (TS2493) — which makes
// this the one assertion in the file whose subject is shipped code.
// @ts-expect-error TS2493, then TS2344.
export type CreateAppTakesAppOptions = Expect<Equal<Parameters<typeof createApp>[1], AppOptions | undefined>>;
