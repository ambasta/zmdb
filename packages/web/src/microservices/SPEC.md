# SPEC — microservice transports: the strategy, the message context, and who acknowledges (frozen)

Part of `@zmdb/web`, a new `./microservices` subpath. gRPC is `./grpc/SPEC.md`; it is a separate file because
it is not a broker and almost none of the decisions below apply to it (§10 draws the line).

The subject of this file is failure, not dispatch. Dispatch is a `Map.get`. What makes a broker consumer
either dependable or a source of 3am pages is the answer to four questions — who acknowledges, when, what a
throw means, and what happens to a message that can never succeed — and every one of those has a default that
looks harmless and produces a consumer that saturates a broker with the same poisoned message forever.

## 1. What the epic got wrong, and it is the most important decision here

`#556`'s premise is that "the message context has to be a sibling of the HTTP context rather than a parallel
universe, for the same reason the GraphQL execution context does: a guard that checks a permission should work
in both", and `#557` step 2 turns that into `MessageContext.request: RequestContext`.

**The GraphQL precedent does not transfer, and the reason is specific.** `GqlCtx<Parent, Args, R> extends Ctx<…>`
works (`../graphql/SPEC.md` §10) because a GraphQL request genuinely **is** an HTTP request: it arrived as
`POST /graphql` with real headers, a real method and a real path, and `RequestFacts { headers, method, path }`
describes it truthfully. A message off a broker has no method and no path. Making `MessageContext` extend `Ctx`
means inventing values for both, and the moment those values exist every guard anyone has ever written becomes
_silently applicable_ to messages — `ctx.path.startsWith('/admin')` compiles, runs, and is false for every
message, so an authorisation check that was protecting a route stops protecting anything and nothing fails.

That is strictly worse than not compiling. `../graphql/SPEC.md:113-118` already refused to widen `Guard` for a
weaker version of this reason ("would have meant editing every guard anyone has written"); here the cost of
widening is a security hole rather than a refactor.

So: **`MessageContext<T>` does not extend `Ctx`, and `Guard` is not reused.** §3 says what _is_ shared, which
turns out to be enough to satisfy what `#556` actually wanted, and §3.3 records the amendment to its
Definition of Done rather than quietly failing the item.

## 2. The strategy interface

Every member below is justified against at least two of the three shipped strategies (Redis, NATS, RabbitMQ —
`#556` DoD 4), because `ARCHITECTURE.md` §2.6 requires it.

```ts
export interface RawMessage {
  readonly pattern: string;
  readonly payload: unknown; // parsed, NOT validated
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string | undefined;
  readonly replyTo: string | undefined;
  readonly deliveryAttempt: number;
}

export type Settlement =
  | { readonly kind: 'ack' }
  | { readonly kind: 'retry'; readonly afterMs: number }
  | { readonly kind: 'dead'; readonly reason: string };

export interface TransportCapabilities {
  readonly redelivery: boolean;
  readonly deadLetter: boolean;
  readonly requestResponse: boolean;
}

export interface TransportStrategy {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  listen(dispatch: (message: RawMessage) => Promise<Settlement>): Promise<void>;
  send(pattern: string, payload: unknown, timeoutMs: number): Promise<unknown>;
  emit(pattern: string, payload: unknown): Promise<void>;
  close(graceMs: number): Promise<void>;
}
```

### 2.1 `listen(dispatch)` — and why the callback _returns_ the settlement

The obvious shape is `ack()` and `nack()` methods on the message, which is what `#557`'s API surface proposes.
It is refused for one reason: **a handler that forgets to acknowledge has to be impossible.** With `ack()` on
the context, forgetting the call is a handler that runs, succeeds, returns, and leaves a message in flight until
the broker's visibility timeout redelivers it — a bug with no error, no log line and a symptom (everything
happens twice) that appears under load and not in a test.

Returning a `Settlement` from `dispatch` makes acknowledgement a **return type**. The dispatcher (§5) produces
it from what the handler did, so the handler never touches it, and the strategy applies it while still holding
whatever per-message token it needs — RabbitMQ's delivery tag, JetStream's reply subject. Those tokens cannot be
public fields on `RawMessage` without becoming part of the custom-transport contract (§11), so keeping the
settlement inside the callback's return is also what keeps `RawMessage` portable.

Both other candidate shapes are worse in a way worth recording. A separate `settle(message, outcome)` method
means the strategy has to correlate the outcome back to a message it already forgot about. And an `ack`-on-return,
`nack`-on-throw convention with no return value cannot express `retry` versus `dead` at all, which is §6.

### 2.2 `Settlement` has three arms, and `requeue` is not one of them

`#557` step 1 asks whether `nack({ requeue })` "belongs in the interface or in a transport-specific extension".
**Neither: it does not belong anywhere.** `basic.nack(requeue: true)` returns the message to the head of the
queue immediately, so a handler that fails deterministically re-receives it in microseconds, forever, on the one
broker that offers the option. That is precisely the loop step 5 warns about, offered as a convenience.

`retry` therefore always carries `afterMs`, with no default. RabbitMQ implements it as `basic.nack(requeue: false)`
into a dead-letter exchange whose retry queue carries a message TTL and routes back — the standard delayed-retry
topology, and the only one that honours the delay. JetStream implements it as `nak(delay)` directly.

`dead` is separate from `retry` because "this will never succeed" is a different fact from "not yet", and a
two-arm settlement forces one of them to be spelled as the other. This is the same argument the outbox makes for
its third `status` value (`../../../query-compiler/src/outbox/SPEC.md` §2.2): a threshold on an attempt count
leaves the poison message in the working set to be re-read on every poll.

### 2.3 `capabilities`, and what a strategy that cannot do something owes the application

Redis pub/sub has no acknowledgement, no redelivery and no dead-letter destination. A `retry` settlement on it
is not a delayed retry; it is a **drop**. NATS core is the same. Pretending otherwise is how a spec produces
handlers that are correct on RabbitMQ and lose messages on Redis, which is the failure `#556` names in its
opening paragraph.

So the three booleans are read by the dispatcher, not decoration: constructing a dispatcher over a strategy with
`redelivery: false` **requires** an `onUndeliverable` sink (§5), for exactly the reason `../events/SPEC.md` §3
requires `onError` — the question "where does a message that cannot be retried go?" is answered once, at
construction, by the person who knows, rather than defaulted to silence.

`requestResponse: false` (Redis pub/sub without a reply channel, a fan-out exchange) makes `send` reject with a
`TransportUnsupportedError` rather than hanging until the timeout. A capability the caller can read beats a
timeout the caller has to interpret.

### 2.4 `send` and `emit` are untyped here, and typed one layer up

`#557` proposes `send<Req, Res>(pattern: string, payload: Req): Promise<Res>`. `Res` is supplied by the caller
and checked against nothing — an assertion wearing a generic, which is the shape `../graphql/subscriptions/SPEC.md`
§1 refused for `publish<T>` and `../events/SPEC.md` §2 refused for `EventType<T>`. A reply that arrived over a
network is untrusted in exactly the way a request body is, so `TransportStrategy.send` resolves to `unknown` and
the typed surface is a client with validators:

```ts
export type ClientPatterns = { readonly [pattern: string]: { readonly request: unknown; readonly response: unknown } };

export type MessageClient<P extends ClientPatterns> = {
  readonly [K in keyof P]: (payload: P[K]['request']) => Promise<P[K]['response']>;
};

export interface MessageClientOptions<P extends ClientPatterns> {
  readonly timeoutMs: number;
  readonly validate: { readonly [K in keyof P]: (raw: unknown) => P[K]['response'] };
}

export declare function createMessageClient<P extends ClientPatterns>(
  transport: TransportStrategy,
  opts: MessageClientOptions<P>,
): MessageClient<P>;

export type EventPatterns = { readonly [pattern: string]: unknown };
export type EventPublisher<E extends EventPatterns> = { readonly [K in keyof E]: (payload: E[K]) => Promise<void> };
export declare function createEventPublisher<E extends EventPatterns>(transport: TransportStrategy): EventPublisher<E>;
```

A mapped type rather than a `dispatch(pattern, payload)` method, for the reason `../cqrs/SPEC.md` §2 gives:
`client.getOrder({ id })` is checked by name, and adding a pattern without a response validator is a
missing-property error. `validate` is **total** — a partial map lets the one reply that skipped validation be the
one that needed it.

`EventPublisher` needs no validator map because there is no reply to distrust; that asymmetry is the whole
difference between the two and is why they are two functions.

**A service's pattern map must be declared as a `type` alias, not an `interface`.** This is a real TypeScript
constraint, verified rather than assumed: an `interface` has no implicit index signature, so it fails the
`extends ClientPatterns` constraint outright, and an `interface X extends ClientPatterns` inherits the index
signature, which then appears in `keyof` and makes every mapped-type member fail against `unknown`. The same
rule governs the gRPC service declaration (`./grpc/SPEC.md` §4) and it is stated in both places because it is
the one way to hold either API that produces an error naming a type the user did not write.

### 2.5 `close(graceMs)` takes a required argument

There is no `AsyncDisposable` here. `close` has to mean two things in order — stop accepting deliveries, then
wait for in-flight dispatches to finish — and the second half needs a bound. An unbounded wait is a process that
does not exit, which under an orchestrator means a `SIGKILL` and precisely the abandoned mid-flight message the
wait existed to prevent. So the bound is a required parameter with no default, the same rule §7 applies to
request timeouts and for the same reason: the caller who knows the deployment's grace period is the one who has
to state it.

`Symbol.asyncDispose` is still available on a strategy if it wants `await using` in a script, but it cannot be
the framework's shutdown path, because `[Symbol.asyncDispose]()` takes no argument and therefore cannot carry the
bound.

### 2.6 What is not on the interface

No `connect()`. `listen` connects, and a two-phase API means a strategy can be in a fourth state (constructed,
connected, listening, closed) that every caller has to reason about for no benefit. No `unsubscribe(pattern)`:
the pattern set is fixed at startup (§5), per `#556`'s §1 cost-model constraint. No `pause()`/`resume()`: a
backpressure API that only RabbitMQ can honour would be a method used by one strategy, which §2.6 of
`ARCHITECTURE.md` forbids.

## 3. The message context

```ts
export interface MessageContext<T> {
  readonly kind: 'message';
  readonly pattern: string;
  readonly payload: T; // validated (§4)
  readonly headers: Readonly<Record<string, string>>;
  readonly correlationId: string;
  readonly deliveryAttempt: number;
  readonly transport: string;
}
```

`correlationId` is `string` here and `string | undefined` on `RawMessage`: the dispatcher generates one when the
transport did not supply it, so a handler always has something to put in a log line. **It is not a security
token** — §8 — and authorising from it is the mistake `web-microservices-transports.md` already warns about for
payload identity claims.

`deliveryAttempt` is `1` on first delivery. A strategy that cannot know — Redis pub/sub, NATS core — reports `1`
forever, and that is honest rather than a gap: those strategies have `redelivery: false`, so there is never a
second delivery to count. The two facts cancel exactly, which is why `maxAttempts` (§5) needs no per-transport
caveat.

### 3.1 The shared portion is `headers`, and it is spelled structurally

```ts
export type WithHeaders = { readonly headers: Readonly<Record<string, string>> };
```

`Ctx` (`../context/index.ts:24-35`) declares `readonly headers: Readonly<Record<string, string>>` — the same type,
character for character. So `Ctx`, `RequestFacts`, `GqlCtx` and `MessageContext<T>` all satisfy `WithHeaders`
with **no declaration on any of them**: no `extends`, no new nominal type, no cast, and no edit to a file this
epic does not own. A check written as `(ctx: WithHeaders) => boolean` is callable from an HTTP guard, a GraphQL
guard and a message guard, and that is the whole of what `#556` DoD 2 wanted.

The precedent is `withTransaction(tx: { execute: Driver['execute'] })` (`../../../repository/src/index.ts:135`),
where a structural parameter lets a `TransactionContext` satisfy a repository method that has never heard of it.
A type alias rather than an `interface` deliberately: nothing should be able to `implements WithHeaders`, because
declaring it would suggest the relationship is nominal and invite someone to add a second member.

`WithHeaders` is not `RequestContext`. That name is not used, because `RequestFacts` is already frozen
(`../graphql/SPEC.md` §10.1) for the HTTP-shaped triple `{ headers, method, path }`, and two names one letter
apart for two different subsets is how a reader picks the wrong one.

### 3.2 Narrowing, and the field it depends on not existing yet

`kind: 'message'` is not in `'http' | 'graphql'`, so `Ctx | MessageContext<unknown>` is a properly discriminated
union and `ctx.kind === 'message'` narrows with no cast and no `in` test.

**That depends on `Ctx.kind`, which `../graphql/SPEC.md` §10.1 froze and no code has yet.** `Ctx` today
(`../context/index.ts:24-35`) has six members and none of them is `kind`. Until the GraphQL context slice lands
it, the union is narrowed by `'kind' in ctx`, which works and is uglier. Stated here because a spec that assumed
the field silently would produce an implementation slice that does not compile, and the reason would take an hour
to find.

### 3.3 `MessageGuard`, and the amendment to `#556` DoD 2

```ts
export interface MessageGuard {
  canActivate(ctx: MessageContext<unknown>): boolean | Promise<boolean>;
}
```

A separate interface, because `Guard.canActivate(ctx: AnyCtx)` (`../middleware/index.ts:11-13`) takes
`Ctx<Record<string, string>, unknown, QueryValues>` and a `MessageContext` is not one — §1.

`#556` DoD 2 reads "A message context is a sibling of the HTTP context, sharing enough that one guard can serve
both." **The literal reading of that item cannot be met and is amended to:** a message context shares a named
structural portion with the HTTP context, so one _authorisation function_ serves both, invoked through two guard
interfaces. What is shared is the logic; what is not shared is the interface. `#558` should assert the amended
item, and the amendment is recorded here rather than in a commit message because an unexplained DoD change reads
like a slipped requirement.

`Pipe`, `Interceptor` and `ExceptionFilter` are **not** given message counterparts. `Pipe` exists to fold a
request body that arrived as `unknown`; a message payload is validated by the decorator's own validator (§4)
before a handler is reached, so there is nothing left to pipe. `Interceptor` and `ExceptionFilter` are refused
for a blunter reason: `runChain` is **never called** by `createApp` (`../graphql/SPEC.md` §8), so the HTTP chain
those interfaces belong to does not currently run, and building a second unwired chain would double the thing
that is already not working.

## 4. `@MessagePattern` versus `@EventPattern`, made a compile error

```ts
export declare function MessagePattern<T, R>(
  pattern: string,
  validate: (raw: unknown) => T,
): (target: (ctx: MessageContext<T>) => R | Promise<R>, context: ClassMethodDecoratorContext) => void;

export declare function EventPattern<T>(
  pattern: string,
  validate: (raw: unknown) => T,
): (target: (ctx: MessageContext<T>) => void | Promise<void>, context: ClassMethodDecoratorContext) => void;
```

`MethodDecorator` — which `#557`'s API surface names — is the legacy decorator type and does not apply under
Stage 3 (`experimentalDecorators` is `false`). The correction is the same one `../graphql/SPEC.md` §13,
`../graphql/subscriptions/SPEC.md` §3 and `../events/SPEC.md` §6 record.

Two properties come out of that signature, and both were verified against the compiler rather than reasoned
about:

1. **`#557` step 3's return-value rule is a compile error, not a documented no-op.** A method decorated
   `@EventPattern` whose return type is anything but `void`/`Promise<void>` fails with `TS1241`. The union
   `void | Promise<void>` is what makes this work: TypeScript's void-return special case applies only when the
   target return type is _exactly_ `void`, so the union defeats it in both directions — an `async` method
   returning `Promise<number>` and a synchronous method returning `number` are both rejected. `Promise<void>`
   alone would catch the `async` case and let the synchronous one through; `Promise<undefined>` would catch both
   and also reject a correct `Promise<void>` handler.
2. **The validator's output type _is_ the handler's payload type.** `T` is inferred from `validate` in the outer
   call and fixed before the decorated method is checked, so `@MessagePattern('order.get', assertSku)` on a
   method taking `MessageContext<GetOrder>` is a `TS1241` naming the missing property. The two facts cannot
   drift.

**The validator is an argument, not something the framework derives.** This is what satisfies `#556` DoD 3 — "no
handler receives an unvalidated payload" — while staying inside how AOT validation actually works: `assert<T>` is
compiled at its call site, so the only place a validator for `T` can be produced is source the user writes. A
decorator cannot see the method's parameter type and could not emit one. Passing it explicitly puts the
generated code where the type is, and makes the omission impossible rather than reviewable.

Decorators here and a mapped type for gRPC (`./grpc/SPEC.md` §4) is a deliberate split, not an inconsistency. A
gRPC service is a **closed** contract shared with another language, so the valuable property is exhaustiveness —
an unimplemented method must not compile — and only a mapped type has it. A broker consumer's pattern set is
open-ended and per-class, there is nothing to be exhaustive against, and what a decorator buys is that the
binding lives on the method instead of in a lifecycle hook (`../events/SPEC.md` §6 makes the same argument for
`@OnEvent`).

**Nothing scans.** `getMessagePatterns(cls)` takes the class, exactly as `getRoutes` (`../routing/index.ts:106`),
`getSubscriptions` (`../gateways/index.ts:59`) and `getEventHandlers` (`../events/SPEC.md` §6) do.
`web-microservices-transports.md`'s "a `@MessagePattern` decorator writing to `Symbol.metadata`, and a dispatcher
reading it" is right about the mechanism and wrong to imply discovery; `web-discovery.md` is unchanged.

```ts
export interface ResolvedMessagePattern {
  readonly pattern: string;
  readonly handlerName: string;
  readonly semantics: 'request' | 'event';
}
export declare function getMessagePatterns(
  cls: abstract new (...args: never[]) => unknown,
): readonly ResolvedMessagePattern[];
```

## 5. The dispatcher, and the sinks it will not default

```ts
export interface DispatcherOptions {
  readonly onUnhandled: (message: RawMessage) => void;
  readonly onInvalidPayload: (message: RawMessage, error: unknown) => void;
  readonly onHandlerError: (message: RawMessage, error: unknown) => void;
  readonly onUndeliverable?: (message: RawMessage, settlement: Settlement) => void;
  readonly maxAttempts?: number; // default 5
  readonly retryAfterMs?: (attempt: number) => number; // default 1s doubling, capped at 30s
}

export interface MessageDispatcher {
  dispatch(message: RawMessage): Promise<Settlement>;
  readonly patterns: readonly string[];
}

export declare function createMessageDispatcher(
  consumers: readonly object[],
  opts: DispatcherOptions,
): MessageDispatcher;
```

The pattern-to-handler map is built **once**, from `getMessagePatterns` over each consumer's constructor, at
construction. `dispatch` is a `Map.get` and a call. That is `#556`'s §1 constraint — "message dispatch resolves
the handler through a structure built at startup, not by scanning patterns per message" — and it is why
`patterns` is exposed: a test can assert every pattern its publishers use is present, which
`web-microservices-custom-transport.md` already recommends doing by hand.

**Patterns match by exact string.** No wildcards, for the reasons `../events/SPEC.md` rejected them (a matcher, a
precedence rule between a wildcard and an exact match, and no answer for a wildcard handler's payload type) plus
one specific to brokers: NATS subject wildcards and RabbitMQ topic bindings have different, non-portable
semantics, so a framework-level wildcard would mean one behaviour on some transports and another elsewhere. A
strategy is free to _subscribe_ with a broker-native wildcard; it reports the concrete subject as
`RawMessage.pattern`, and a subject with no handler is `onUnhandled` plus `{ kind: 'ack' }` — acknowledged,
because a message nobody wants must not be redelivered forever.

The three required sinks are the same argument `../events/SPEC.md` §3 makes for `onError`: the alternatives are
silence, which hides the bug, and `console.error`, which hard-codes a logger into a package that has
deliberately never had one and cannot be asserted against without capturing global state.

`onUndeliverable` is required — despite being spelled optional in the type — whenever
`strategy.capabilities.redelivery` or `.deadLetter` is `false`, because on such a strategy a `retry` or `dead`
settlement is a silent drop (§2.3). The type cannot express "required when a runtime value is false", so
`createMessageDispatcher` throws at construction rather than at the first dropped message. Construction-time is
the right time: a misconfiguration that only surfaces the first time something fails is a misconfiguration that
surfaces in production.

## 6. Acknowledgement, redelivery and invalid payloads — the table

Read this row-first. `#557` step 4 asks for a table because this is the reference a developer returns to.

| Outcome                            | Settlement                    | Redis pub/sub · NATS core       | NATS JetStream               | RabbitMQ                                 |
| ---------------------------------- | ----------------------------- | ------------------------------- | ---------------------------- | ---------------------------------------- |
| handler returned                   | `ack`                         | no-op (nothing to ack)          | `ack()`                      | `basic.ack`                              |
| handler threw, attempts left       | `retry` + `afterMs`           | **dropped** → `onUndeliverable` | `nak(afterMs)`               | `nack(requeue: false)` → TTL retry queue |
| handler threw, `maxAttempts` spent | `dead`                        | **dropped** → `onUndeliverable` | `term()` → dead-letter       | `nack(requeue: false)` → dead-letter     |
| payload failed its validator       | `dead` — never `retry` (§6.1) | **dropped** → `onUndeliverable` | `term()` → dead-letter       | `nack(requeue: false)` → dead-letter     |
| no handler for the pattern         | `ack`                         | no-op                           | `ack()`                      | `basic.ack`                              |
| consumer crashed mid-handler       | none sent                     | message lost                    | redelivered after `ack_wait` | redelivered on channel close             |
| `deliveryAttempt` source           | —                             | always `1`                      | `numDelivered`               | `x-death` count                          |

Acknowledgement is **after** the handler, always. Acking first turns every crash into a lost message, and the
`ack`-first design is only ever chosen to make a slow broker look fast.

The crash row is the one to read twice. Redelivery after a crash is the broker's, on the broker's schedule, and
the framework has no part in it — which is why at-least-once is a property of the arrangement rather than
something the dispatcher provides, and why every handler must be idempotent regardless of which transport it is
running on today.

### 6.1 An invalid payload is dead on arrival, and this is provable rather than prudent

`#557` step 5 asks for "a dead-letter or drop-with-log path" as the default. The default is `dead`, and the
argument is stronger than the risk of a loop: **a validator is deterministic and compiled ahead of time, so a
payload that failed it will fail it again on every redelivery, forever.** Retrying is not a gamble that might pay
off; it is a guaranteed non-terminating loop that saturates one consumer and, because the message stays at the
head of an ordered stream, blocks every message behind it.

So an invalid payload never produces `retry`, on any transport, and no option turns that off. Where
`capabilities.deadLetter` is `false` the message is dropped and `onInvalidPayload` fires — which is exactly why
that sink is required rather than defaulted, and why `onUndeliverable` is enforced at construction (§5).

A message that fails to _parse_ (not valid JSON) is the same case for the same reason, and reaches
`onInvalidPayload` too. The strategy owns parsing, because framing is transport-specific, and it reports a parse
failure as a message whose `payload` is the raw text so the sink has something to inspect.

## 7. Request/response: a required timeout, and what the caller sees

`MessageClientOptions.timeoutMs` is **required, with no default**. `#557` step 6 asks for this and the reason is
in `web-microservices-custom-transport.md` already: "a request/response transport with no deadline turns one slow
consumer into a pile of hanging callers, and the failure looks like your service being slow rather than theirs."
A default would be a number this file guessed for a broker it has never seen.

On expiry the caller gets a rejection with a distinct class:

```ts
export class MessageTimeoutError extends Error {
  readonly pattern: string;
  readonly timeoutMs: number;
  readonly correlationId: string;
}
```

A distinct class rather than a generic `Error`, because "the consumer never answered" and "the consumer threw"
need different responses from the caller — the first is retryable, the second usually is not — and one
indistinguishable error makes that a guess. `ChainError` (`../middleware/index.ts:39-46`) is the precedent for a
web error carrying its own fields.

The client must clear the timer and delete the waiter on **every** exit path, including the rejection. A `Map`
keyed by correlation id that only grows is a leak that takes a week to notice, and `#558` has to assert the map
is empty after both a resolved call and a timed-out one — the second is the assertion that would otherwise be
missing.

A remote handler's thrown error crosses back as a message, so the reply envelope carries either a result or an
error, and the client rejects with a `MessageRemoteError` whose message is the **generic** string the remote side
chose. `String(error)` in a reply leaks table names and sometimes values to the caller; the detail stays local
via `onHandlerError`.

## 8. Correlation is generated, never accepted

`#557` step 7: the correlation id is produced by the client with `globalThis.crypto.randomUUID()` and there is no
parameter for supplying one. Two independent failures, either of which is sufficient:

- **Collision.** Two callers picking the same id on a shared reply channel resolve each other's promises — the
  exact failure `web-microservices-custom-transport.md` names ("concurrent calls on a shared reply channel
  resolve each other's promises"). A caller-supplied id makes that the caller's problem to get right, at every
  call site.
- **Forgery.** An id is the thing a reply is matched against. A publisher who can choose one can publish a reply
  for somebody else's outstanding request, and the client will resolve it as authentic.

Matching uses a per-caller reply destination **and** the id inside it. Both, because either alone is
insufficient: a shared reply channel needs the id to demultiplex, and a per-caller channel still needs it when
the caller has more than one call in flight, which it always does.

The inbound `RawMessage.correlationId` is passed through to `MessageContext.correlationId` for logging and for
the reply envelope. It is never used for authorisation, and never trusted to be unique — it was written by
whoever published the message.

## 9. What ships, what is deferred, and the deferrals are arguments

`#556` DoD 4 requires Redis, NATS and RabbitMQ, "with Kafka and MQTT either shipped or explicitly deferred with
a reason". Both are deferred, and the reasons are properties of the interface in §2 rather than a shortage of
time:

**Kafka.** A partition is an ordered log with a consumer-group offset, not a queue with per-message
acknowledgement. Committing an offset acknowledges _everything up to it_, so `{ kind: 'dead' }` on message N
while N−1 is still in flight is not expressible — there is no way to settle one message without settling its
predecessors. Kafka needs a different settlement model (offset commit plus a genuine dead-letter topic), which
means either a second interface or a leaky first one. Recorded as a design boundary so it is not read as an
oversight.

**MQTT.** QoS is the settlement model and it is chosen per subscription, not per message. `retry.afterMs` has no
analogue at all: the broker redelivers QoS 1 and 2 on reconnect, on its own schedule, and nothing the application
does influences the delay. A strategy that silently ignored `afterMs` would be worse than one that does not
exist, because a handler written against a delay it is not getting is a handler whose retry storm is invisible in
review.

**No TCP strategy**, and this is the interesting one because upstream test suites assume one.
`tests/api-coverage/mapping.mjs:909` currently maps `microservices/e2e/*` to `NO_MICROSERVICES`, whose argument
is "A message bus is a different product, and pretending otherwise with a thin wrapper would be a worse answer
than not having one." That sentence becomes **false for the parts this epic ships and stays true for TCP**, so
the entry is narrowed rather than deleted:

- `microservices/e2e/sum-rpc` (11 assertions), `sum-rpc-async` (1) and `disconnected-client` (5) become in scope —
  they are request/response, reconnection and error-propagation behaviours that §2 and §7 do specify.
- `microservices/e2e/sum-rpc-tls` (11) and `tcp-json-socket-pipeline` (1) stay out of scope under a narrowed
  reason: zmdb ships no bespoke length-prefixed-JSON socket protocol, because that is the one transport where
  "bring a broker" is strictly better advice than "use ours".

**The mapping edit belongs to `#558`, not here.** `mapping.mjs` cites test titles by exact text, so an entry
added before the tests exist is a dangling reference and a build failure. `inventory.mjs:652-656` already carries
the five suites and their weights, so nothing needs adding there.

## 10. The hybrid application

`#557` step 10. `createApp` gains a second parameter:

```ts
export declare function createApp(rootModule: ModuleClass, opts?: AppOptions): App;
export interface AppOptions {
  readonly transports?: readonly TransportStrategy[];
  readonly dispatcher?: DispatcherOptions;
  readonly graceMs?: number; // default 5_000, passed to close()
}
```

`App` gains **nothing**. There is no `connectMicroservice` and no `startAllMicroservices`, because `init()` is
already the one place startup happens and a second entry point would let an application forget it — the same
argument §2.1 makes about `ack()`.

Startup order inside `init()`:

1. `compileModule(rootModule)` — already done in `createApp`, synchronous, no I/O.
2. `runInit(lifecycleInstances)` — `onModuleInit` then `onApplicationBootstrap`, both full passes
   over constructed providers and controllers (`../lifecycle.ts`). Unchanged in phase order.
3. Build the dispatcher from `controllers` — pattern map resolved once (§5).
4. `transport.listen(dispatch)` for each transport, in declaration order, awaited.

The dispatcher is built **after** `runInit` because a consumer's `onModuleInit` may be what prepares it, and
`listen` comes last because a message must never arrive before the bootstrap hooks have run. That is the whole
ordering argument, and it is why steps 3 and 4 are not one step.

**Partial failure: if any `transport.listen` rejects, `init()` rejects and the application does not serve.** The
alternative — serve HTTP, report the broker failure to a sink — produces a process that passes its health check
and silently drops every message, which is worse than either extreme because nothing notices. A deployment that
genuinely wants HTTP-only degradation gets it by not passing the transport to `createApp`: the `main.ts`
composition `web-hybrid-application.md` already recommends, where the two surfaces fail independently because
they are two statements.

Before rejecting, `init()` must `close(graceMs)` the transports it already opened. Otherwise a crash-looping pod
leaks one broker connection per attempt, and the broker's connection limit becomes the outage.

Shutdown, in `[Symbol.asyncDispose]`, in this order:

1. `close(graceMs)` each transport in **reverse** declaration order — stop intake first, then drain.
2. `runShutdown(lifecycleInstances)` — reverse construction order (`../lifecycle.ts`).

Transports close before the hooks run, because a handler whose repository has already been disposed is worse than
a message that waits for the next process. An ordinary constructed provider now receives shutdown, but a
transport still belongs in `AppOptions`: `close(graceMs)` needs the app-wide grace bound and must stop intake
before any provider/controller hook runs. App ownership also keeps `#556`'s §2.7 "no module-level connection
singletons" true by construction.

HTTP is unaffected by all of this. `createApp` does not create a server; the caller does, with
`toNodeHandler(router)` or `app.fetch`. Which raises a real defect worth naming: `toNodeHandler(app)` appears in
seven docs pages and **does not typecheck** — `toNodeHandler(router: Router)` (`../pipeline/index.ts:303`) needs
`register`, and `App` (`../app/index.ts:14-19`) has only `container`, `handle`, `fetch`, `init` and
`[Symbol.asyncDispose]`. The adapter uses nothing but `handle`, so the parameter should be
`Pick<Router, 'handle'>`; that is a one-line change to `../pipeline/index.ts` and it belongs to the epic that owns
`pipeline/SPEC.md`, not to this one. The two pages this issue owns are corrected to `toNodeHandler(router)`, the
idiom `web-standalone.md` and `web-pipeline.md` already use.

## 11. The custom-transport contract and the stability promise

`#557` step 11. A third-party strategy may rely on exactly these, and nothing else:

| Public                                      | What a strategy does with it               |
| ------------------------------------------- | ------------------------------------------ |
| `TransportStrategy`                         | implements it                              |
| `TransportCapabilities`                     | declares it, honestly                      |
| `RawMessage`                                | constructs one per delivery                |
| `Settlement`                                | reads the dispatcher's return              |
| `TransportUnsupportedError`                 | throws it from an unsupported `send`       |
| `MessageTimeoutError`, `MessageRemoteError` | may throw; the client also constructs them |

Not public, and not to be reached for: `createMessageDispatcher`'s internal pattern map, `MessageContext`
construction (the dispatcher builds it; a strategy that builds one has bypassed validation), and anything under
`./grpc`.

The promise: **additive only within a major.** A member may be added to `RawMessage`, because a strategy
constructs one and a new member with a defined default does not break an existing constructor call. A member may
_not_ be added to `TransportStrategy`, because a strategy implements it and every addition breaks every
implementation — which is the asymmetry that makes §2.6's "no `pause()`/`resume()`" a decision worth getting
right now rather than later. A `Settlement` arm may not be added for the same reason a strategy's `switch` would
silently fall through it.

`#556` DoD 6 requires the seam be "demonstrated by a strategy written entirely against public API". The
in-repository demonstration is the in-memory strategy `#558` needs anyway — `capabilities` all `true`, a `Map` of
queues, a settable clock — which makes every assertion in §6's table testable with no broker, and makes the
public list above load-bearing rather than aspirational.

## 12. What #558 has to assert

1. `an event handler that returns a value does not compile` — type-test, both the `async` and the synchronous
   form, because §4 turns on the union catching both.
2. `a validator whose output does not match the handler's payload type does not compile` — type-test.
3. `a handler never sees an unvalidated payload` — a failing validator with a handler spy at zero calls.
4. `an invalid payload settles dead, never retry` — §6.1, on a strategy with `redelivery: true`, so the
   assertion is about the decision and not about a capability.
5. `an unparseable message reaches onInvalidPayload with the raw text` — the other half of §6.1.
6. `a thrown handler settles retry until maxAttempts and then dead` — assert the sequence, driven by
   `deliveryAttempt`.
7. `retryAfterMs is honoured` — through the fake strategy's recorded settlements, not a real sleep.
8. `an unknown pattern acks and reaches onUnhandled` — the row that would otherwise loop forever.
9. `constructing a dispatcher over a strategy with redelivery: false and no onUndeliverable throws` — §5,
   asserting it happens at construction rather than on the first drop.
10. `send rejects with MessageTimeoutError and the waiter map is empty afterwards` — §7, both halves in one test.
11. `send rejects with MessageTimeoutError rather than hanging when requestResponse is false` — §2.3.
12. `two concurrent calls resolve their own replies` — §8, with the fake strategy delivering replies out of order,
    which is the only arrangement that can catch a broken correlation.
13. `a correlation id is generated per call and is not read from the payload` — §8.
14. `one authorisation function written against WithHeaders is callable from both a Guard and a MessageGuard` —
    §3.1, the amended DoD 2.
15. `MessageContext is not assignable to Ctx and Ctx is not assignable to MessageContext` — type-test, the
    assertion that pins §1 so a later convenience cannot undo it.
16. `listen is called after onApplicationBootstrap` — §10, ordering, via a recording strategy.
17. `a rejecting listen rejects init and closes the transports already opened` — §10, both halves.
18. `dispose closes transports before running shutdown hooks` — §10, asserting the order and not just that both
    happened.
19. `the pattern map is built once` — a consumer whose `getMessagePatterns` reader is counted, asserted at one
    call for N dispatches. This is what pins `#556`'s cost-model constraint.

## Non-goals (rejected)

- **No `MessageContext extends Ctx` and no `RequestContext` member.** §1 — fabricating `method` and `path` makes
  every HTTP guard silently applicable to messages, and silently false.
- **No widening of `Guard` to accept a message context.** §3.3 — `../graphql/SPEC.md:113-118` refused the same
  widening for a weaker reason.
- **No `ack()`/`nack()` on the message context.** §2.1 — a forgotten acknowledgement has to be impossible, and a
  return type is the only shape that makes it so.
- **No `requeue` option, anywhere.** §2.2 — immediate head-of-queue requeue is the redelivery loop, offered as
  a convenience.
- **No caller-supplied `Res` on `send`.** §2.4 — a generic the caller instantiates is an assertion, and a reply
  off a broker is untrusted.
- **No `dispatch(pattern, payload)` client.** §2.4 — a string-keyed entry point loses the per-pattern request and
  response types the map already has.
- **No partial `validate` map on the client.** §2.4 — the reply that skipped validation is the one that needed it.
- **No wildcard or hierarchical patterns.** §5 — NATS and RabbitMQ disagree about what a wildcard means, so a
  framework-level one is portable in spelling only.
- **No `retry` for an invalid payload, and no option to enable it.** §6.1 — a deterministic validator makes the
  loop a certainty rather than a risk.
- **No default request timeout.** §7 — it would be a number guessed for a broker this file has never seen.
- **No `connect()`, `unsubscribe()`, `pause()` or `resume()` on the strategy.** §2.6 — one extra state, or one
  method a single broker can honour.
- **No `AsyncDisposable` as the shutdown path.** §2.5 — `[Symbol.asyncDispose]()` takes no argument, so it cannot
  carry the required grace bound.
- **No Kafka strategy.** §9 — offset commit acknowledges every predecessor, so a per-message `Settlement` has no
  meaning; deferred, not dismissed.
- **No MQTT strategy.** §9 — `retry.afterMs` has no analogue, and silently ignoring a parameter is worse than
  not offering it.
- **No TCP transport.** §9 — a bespoke length-prefixed JSON socket is the one case where "bring a broker" is
  better advice.
- **No message-side `Pipe`, `Interceptor` or `ExceptionFilter`.** §3.3 — the payload is already validated, and
  `runChain` is not even wired into the HTTP pipeline yet (`../graphql/SPEC.md` §8).
- **No `connectMicroservice` or `startAllMicroservices` on `App`.** §10 — `init()` is the one place, so it cannot
  be forgotten.
- **No HTTP-serves-anyway degradation on broker failure.** §10 — a process that passes its health check and drops
  every message is the outcome nobody notices.
- **No transport in the DI container.** §10 — transport shutdown needs `close(graceMs)` before ordinary
  provider/controller hooks; the generic `OnShutdown` signature cannot carry that app-wide bound.
- **No filesystem or metadata discovery.** §4 — `web-discovery.md`, unchanged.
