# SPEC — subscriptions: pub/sub, lifetime, backpressure and cleanup (frozen, not planned)

> **Not planned.** GraphQL is out of scope for zmdb: the epics and every sub-issue under
> them are closed as wontfix, and no code in this tree implements this document. It stays
> frozen as the record of what was decided and why — the failure modes it names are the
> ones anyone building this outside zmdb will meet.

Part of `@zmdb/web`, exported from the `./graphql` subpath. `../SPEC.md` owns queries and mutations; this file
owns the third operation and everything that only goes wrong once a connection is long-lived.

Four of the decisions here cannot be retrofitted, and all four are about failure rather than delivery:
how long an authorisation verdict is good for, what happens to a subscriber that stops reading, what is
guaranteed to be released when a connection ends, and whether a filter is allowed to look like a permission
check. A spec written around the happy path omits exactly these, which is why they come first.

## 1. The pub/sub interface, and why `AbortSignal` is in it

```ts
export interface PubSub {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(topic: string, signal: AbortSignal): AsyncIterable<unknown>;
}

export declare function createMemoryPubSub(opts?: { readonly buffer?: number }): PubSub;
```

**`payload` is `unknown` and so is the iterable's element.** The issue's `publish<T>(topic, payload: T)` and
`subscribe<T>(…): AsyncIterable<T>` put the type where the caller chooses it, which is an unchecked assertion
dressed as a generic — a publisher and a subscriber who disagree about `T` compile cleanly and fail at
runtime, in a different process from the one that was wrong. A published payload crosses a boundary
(ARCHITECTURE.md §2.3), so it is validated on the way out of the iterable, by the same mechanism a field's
arguments are (§3). The typed surface is §2, one layer up.

**`AbortSignal` is the only cancellation path, and there is no `unsubscribe`.** A signal is passed in rather
than a teardown function returned, and the difference is that the caller cannot forget it: the four ways a
subscription ends (§6) all abort the same signal, so cleanup is one code path with four triggers instead of
four teardown call sites, one of which would eventually be missing. `docs-site/content/web-graphql-subscriptions.md`
already shows the alternative — `req.on('close', () => { clearInterval(keepalive); stop(); })` — and names the
consequence of omitting it: "a leak that grows with churn, not with load".

This is the same primitive `query-cancellation.md` proposes for `Driver.execute`, and that page's open
question is "whether `Ctx` grows a `signal`". This freeze answers it **only for a subscription context** (§4),
where the connection genuinely has one, and leaves `Ctx` and `WebRequest` alone. A partial answer that does
not force every adapter to change is worth more than a blocked one.

`createMemoryPubSub` is the in-process implementation. It is not a module-level singleton and holds no static
state (ARCHITECTURE.md §2.7): it is a provider on the app's container, so two apps in one process do not share
subscribers — which is also what makes §6's zero-subscriber assertions deterministic.

An external broker is an adapter over the same two methods. `web-graphql-subscriptions.md` already documents
why one is eventually needed (an in-process broadcast reaches one replica) and both candidate answers,
Postgres `LISTEN/NOTIFY` and Redis; neither ships here.

## 2. Topics are typed one layer up, because a topic typo is silent

A wrong topic string subscribes successfully and then never fires, which is indistinguishable from a quiet
topic. `PubSub` stays string-keyed because an adapter must be implementable against a broker that has only
strings; the typing goes in front of it:

```ts
export interface TopicMap {
  readonly [topic: string]: unknown;
}

export interface Topics<M extends TopicMap> {
  publish<K extends keyof M & string>(topic: K, payload: M[K]): Promise<void>;
  subscribe<K extends keyof M & string>(topic: K, signal: AbortSignal): AsyncIterable<M[K]>;
}

export declare function topics<M extends TopicMap>(pubsub: PubSub, validate: TopicValidators<M>): Topics<M>;

export type TopicValidators<M extends TopicMap> = { readonly [K in keyof M]: (raw: unknown) => M[K] };
```

```ts
interface AppTopics {
  'post.created': { readonly id: number };
  'post.deleted': { readonly id: number };
}

const bus = topics<AppTopics>(pubsub, {
  'post.created': raw => assert<{ id: number }>(raw),
  'post.deleted': raw => assert<{ id: number }>(raw),
});
```

`TopicValidators<M>` requires an entry for **every** topic — a mapped type over `keyof M`, not a partial — so
declaring a topic and forgetting to validate it does not compile. The validators are `assert<T>` calls at the
app's own call site, which is where the transform can resolve `T`, exactly as `ResolverBindings.validate` is
(`../SPEC.md` §3). Nothing here walks a type at runtime.

Validation happens **on the subscriber's side**, as the payload leaves the iterable. Validating in `publish`
would be the wrong place with a broker in the middle: the process that publishes is not necessarily the
process that is wrong, and a payload can be written to the broker by something that is not this application
at all.

### 2.1 Scoping a topic is the authorisation mechanism that cannot be forgotten

A topic name may be derived from the authenticated identity at subscribe time — `post.created:tenant-7` — and
that is the recommended shape for anything multi-tenant. It is stronger than any check further down because
there is no code path that could subscribe to another tenant's topic: the name does not exist unless the
identity produced it. `web-graphql-subscriptions.md` states the same rule for its SSE example ("scope the
subscription to the authenticated tenant… the client filters, which means the client receives"), and §5 is
why the alternative is refused.

## 3. `@Subscription`, and two things it is not

```ts
export declare function Subscription(name?: string): (target: Function, context: ClassMethodDecoratorContext) => void;

export interface SubscriptionOptions<Payload, Args> {
  readonly topic: string | ((args: Args) => string);
  readonly filter?: (payload: Payload, args: Args) => boolean;
  readonly chain?: Chain;
  readonly reauthMs?: number; // 5000 — §5
  readonly buffer?: number; // 64 — §7
}
```

**No `returns: () => unknown` thunk.** `../SPEC.md` §1 refused thunks for `@Query` and `@Mutation` for a reason
that applies unchanged here: there is no runtime type to return, and a thunk that exists only to be ignored is
a parameter every caller has to write and no code reads. The payload type comes from the `F` map that
`register<F>` already takes.

**`MethodDecorator` does not exist.** The issue spells this and the federation decorators with the legacy
TypeScript decorator types; under Stage 3 the shape is `(target, context: ClassMethodDecoratorContext)`, the
same correction `../SPEC.md` §13's `@Complexity` records.

**The exported name collides with something already shipped**, and the collision is resolved by renaming the
other one. `gateways/index.ts:15` exports `interface Subscription { event; handlerName }`, re-exported from the
root barrel at `packages/web/src/index.ts:158`, so two different `Subscription`s cannot both be re-exported
from it. The gateways interface is renamed **`EventBinding`**, because that is what it is — a handler bound to
an event name, not a subscription to anything — and `Subscription` is left to mean what every GraphQL user
already thinks it means. `@Subscribe` and `getSubscriptions` keep their names: they are about events, and
"subscribe to an event" reads correctly. This changes `gateways/SPEC.md` and `packages/web/src/index.ts`, and
`#552` asserts the old name is gone rather than deprecated.

`topic` may be a function of the arguments, which is what makes §2.1 expressible: `topic: args => \`post.created:${args.tenant}\`` — evaluated once, at subscribe time, after the arguments have been validated and piped.

## 4. The subscription context

```ts
export interface SubCtx<Payload, Args, R extends RequestFacts> extends GqlCtx<Payload, Args, R> {
  readonly signal: AbortSignal;
  readonly operation: 'subscription';
}
```

**`parent` is the published payload.** A subscription field resolves once per event with the event as its root
value, so the member that already means "the value this field is resolving against" is the right one, and
nothing new is needed. A `@ResolveField` reached from a subscription type therefore works unchanged.

`operation` on `GqlCtx` is `'query' | 'mutation'` in `../SPEC.md` §2 and **widens to include
`'subscription'`**. That is an amendment to a frozen section, recorded here and in `#552`'s type-test.

`signal` is aborted by every one of §6's four paths, so a resolver that starts its own work — a `setInterval`
keepalive, an outbound fetch — has the one thing it needs to stop, without knowing which path ended it.

`kind` (`../SPEC.md` §10.2) stays `'graphql'`. A subscription is not a third transport as far as a guard is
concerned, and `isGqlCtx` narrows it correctly.

## 5. Authorisation lifetime: one mechanism, three behaviours, and the default is the safe one

A guard that runs once at subscribe time and never again means **a revoked token keeps receiving data
indefinitely**. That is the failure the epic calls out, and silence about it is not defensible. All three
candidate answers, with their real costs:

| Policy                        | Exposure after revocation | Guard evaluations for _s_ subscribers and _e_ events |
| ----------------------------- | ------------------------- | ---------------------------------------------------- |
| subscribe-time only           | unbounded                 | _s_                                                  |
| periodic re-check every _t_ms | up to _t_ ms              | _s_ × (connection lifetime / _t_)                    |
| per event                     | none                      | _s_ × _e_                                            |

They are the same mechanism with one number: **the guard runs before delivery, and its verdict is memoised
per subscription for `reauthMs`.** `reauthMs: 0` is per-event, a large value is periodic, and
`Number.POSITIVE_INFINITY` is subscribe-time only — which has to be written out, so it reads as a choice
rather than as the thing that happened by default.

**The default is `reauthMs: 5000`.** Exposure after a revocation is at most five seconds. The cost matters and
is the reason the default is not 0: a guard that queries the database, on a topic with 1,000 subscribers
publishing 100 events a second, is 100,000 queries a second under per-event and at most 200 under the default.
Per-event authorisation is a denial-of-service amplifier pointed at your own database, and a spec that made it
the default would be trading one outage for another.

**A guard that fails mid-stream terminates that operation with an error.** It does not skip the event. Skipping
looks gentler and is worse: the client keeps a subscription it believes is live, sees no activity, and cannot
distinguish that from a quiet topic — so it never re-authenticates and never learns. The client observes an
`error` message with `extensions.code = 'FORBIDDEN'` for that operation id, then the operation completes. The
**socket stays open**: one connection carries many operations, and killing all of them because one lost
permission is a failure the client cannot localise either.

The exception is connection-level: a `connection_init` payload that does not authenticate closes the socket
(§8), because there is nothing to keep it open for.

## 6. Cleanup: four triggers, one path, and a count you can assert

| Trigger                | How it reaches the subscriber                                    |
| ---------------------- | ---------------------------------------------------------------- |
| client disconnect      | the adapter aborts the connection's controller                   |
| client `complete`      | the session aborts that operation's controller                   |
| an error in the stream | the session aborts, after sending `error`                        |
| app disposal           | the registry's `onShutdown` aborts every connection's controller |

Every row ends in `AbortController.abort()`, and every subscriber's teardown hangs off `signal`. There is no
second teardown path to keep in step, which is the whole argument for §1's shape.

Server shutdown uses the existing hook: the subscription registry implements `OnShutdown`
(`packages/web/src/lifecycle.ts:20-22`), and `runShutdown` runs those in **reverse construction order**
(`lifecycle.ts:49-54`), so the registry tears down before the providers its resolvers depend on. There is no
`app.dispose()` — the surface is `await using app = createApp(…)`, which calls `App[Symbol.asyncDispose]`
(`app/index.ts:38`).

**One gap has to be named rather than assumed away.** `createApp` wires disposal as
`runShutdown(controllers)` (`app/index.ts:38`), so `onShutdown` fires for **controllers only** — a registry
registered as a _provider_ is never torn down, and every open subscription survives the app that served it.
Extending hook detection to providers is the app epic's, not this one's; until it lands, the registry must be
reachable from a controller, and `#552` asserts disposal through a controller-held registry so the test does
not silently depend on the broken path.

Inspection, so the assertion the epic requires is possible without reaching into internals:

```ts
export interface SubscriptionRegistry {
  subscriberCount(topic?: string): number;
  connectionCount(): number;
}
```

`#552` asserts **zero** from both after each of the four triggers, and after `app.dispose()` with connections
still open. A count that is merely small is a leak with a slower clock.

### 6.1 `sseStream` leaks today, and it has to stop

`sseStream` (`gateways/index.ts:123-137`) builds a `ReadableStream` whose underlying source has a `pull` and
**no `cancel`**. When a client disconnects the stream is cancelled, and nothing calls `iterator.return()` — so
the source async iterable is never told, keeps running, and keeps whatever it holds. That is a real leak in
shipped code, on the exact path a subscription would use, and no cleanup guarantee in this file is true while
it is there. `#552` covers it: `cancel(reason)` calls `iterator.return?.()`, asserted with a source that
records whether it was closed.

## 7. Backpressure: a bounded buffer per subscriber, and overflow closes the operation

An unbounded buffer is a memory-exhaustion bug reachable by a client that opens one subscription and simply
stops reading. It is ruled out, explicitly, in the interface: `createMemoryPubSub({ buffer })` has a default
and no way to say "no limit".

**`publish` never waits for a subscriber.** Pull-based backpressure all the way to the publisher is the
tempting answer — the existing `sseStream` really is pull-based, via `ReadableStream.pull` — and it is wrong
here, because `publish` is called from a transaction commit or a `NOTIFY` handler. Letting one slow client
apply backpressure to that is head-of-line blocking across every tenant: the slowest subscriber in the system
sets the rate for everyone, which converts a client-side problem into an outage. `publish` enqueues to each
subscriber's bounded buffer and returns.

Within the bound, delivery **is** pull-based: the buffer only fills while the consumer is behind, and a
consumer that keeps up never buffers more than one event.

**On overflow the operation is terminated, not trimmed.** Dropping the oldest event is the other common choice
and it is refused: a GraphQL subscription payload carries no sequence number, so a dropped event is invisible
to the client — it receives a stream that is silently incomplete and has no way to detect it, which is the
worst failure mode available. Terminating is recoverable: the client sees

```json
{ "message": "subscriber fell behind: 64 events buffered", "extensions": { "code": "SUBSCRIPTION_OVERFLOW" } }
```

and reconnects, re-fetching current state through the authorised query path. Unlike the complexity limit
(`../complexity/SPEC.md` §7), the bound **is** in the message: it is a capacity fact, not a security control,
and knowing it is what makes the client's own batching fixable.

**Default `buffer: 64`.** Small enough that a stuck subscriber costs kilobytes rather than megabytes, large
enough to absorb a burst from a `NOTIFY` fan-out or a `Promise.all` of writes. Per subscriber, not per topic,
because a subscriber is what can be slow.

## 8. Transport: `graphql-ws`, and the socket is still yours

The protocol is **`graphql-transport-ws`**, the subprotocol of the `graphql-ws` library, which is what current
clients speak. The version and the close codes below are **dated vendor data**, recorded the same way
`../../../../schema-core/src/sdl/SPEC.md` §8.1 records `graphql`'s `Kind` strings: they are stable because they
are a published protocol, not because we control them, and `#552` pins them so a drift is a test failure.

`@zmdb/web` implements the **protocol state machine** and not the socket, for the reason `../SPEC.md` §6 gives
for `POST /graphql`: the socket server is a dependency and a deployment decision, and the existing
`gateways/SPEC.md` already puts "a concrete WebSocket server binding" out of scope.

```ts
export interface WsSession {
  /** One inbound frame. Never throws; protocol errors are sent and/or close the socket. */
  receive(raw: string): Promise<void>;
  /** The adapter's socket closed. Aborts every operation on this connection. */
  closed(): Promise<void>;
}

export declare function createWsSession(opts: {
  readonly registry: GraphqlRegistry;
  readonly send: (raw: string) => void;
  readonly close: (code: number, reason: string) => void;
  /** connection_init's payload → the request facts every guard reads, or undefined to refuse. */
  readonly connectionInit: (payload: unknown) => RequestFacts | undefined | Promise<RequestFacts | undefined>;
  readonly initTimeoutMs?: number; // 3000
}): WsSession;
```

**`connectionInit` returns `RequestFacts`** — the type `../SPEC.md` §10.1 introduces — and that is the whole
authentication handshake. The consequence is the one worth having: a guard reads
`ctx.headers.authorization`, and it does not matter whether those headers arrived on an HTTP request, were
lifted from a GraphQL field's context, or were synthesised from a `connection_init` payload. One guard, three
surfaces, no adapter shims.

Returning `undefined` refuses the connection with close code **4403**. The frames and codes:

| Direction | Message                       | Notes                                                                    |
| --------- | ----------------------------- | ------------------------------------------------------------------------ |
| in        | `connection_init`             | must arrive within `initTimeoutMs` or the socket closes **4408**         |
| out       | `connection_ack`              | after `connectionInit` resolves to facts                                 |
| in        | `subscribe` `{ id, payload }` | a duplicate live `id` closes **4409**; a malformed frame closes **4400** |
| out       | `next` `{ id, payload }`      | one per delivered event                                                  |
| out       | `error` `{ id, payload }`     | terminates that operation only (§5)                                      |
| out       | `complete` `{ id }`           | the stream ended, or the client asked                                    |
| in        | `complete` `{ id }`           | aborts that operation's controller (§6)                                  |
| both      | `ping` / `pong`               | keepalive; the adapter may also use WebSocket-level frames               |

A `subscribe` frame arriving before `connection_ack` closes **4401**. A `query` or `mutation` sent over the
socket is served — the protocol allows it, one `next` then `complete` — and it runs the same chain and the
same validation as over HTTP; refusing it would mean the same operation is authorised differently depending on
which pipe it arrived through.

The keepalive is the adapter's, and it matters: `web-graphql-subscriptions.md` already records that proxies
close idle connections at 30–60 seconds, and a subscription on a quiet topic is idle by definition.

**This does not depend on the streaming work.** `web-graphql-subscriptions.md`'s header names two blockers, one
of which is that `WebResponse.body` is a `string` so the router cannot stream. That blocks `graphql-sse`, which
is not what this specifies: a WebSocket never passes through `WebResponse` at all, so the only real
prerequisite is the GraphQL layer. `graphql-sse` is a non-goal here and becomes possible once the responses
epic lands.

## 9. A filter is not an authorisation check, and the signature is what enforces it

```ts
readonly filter?: (payload: Payload, args: Args) => boolean;
```

**`filter` is not given the context, deliberately.** It cannot see `headers`, cannot see the viewer, and cannot
reach the container — so it is structurally incapable of being a permission check, rather than merely
documented as not being one. The issue's own signature already omits `ctx`; this records that as the point of
it.

The distinction, stated plainly because it has to reach the docs: **a filter is about relevance, a guard is
about permission.** A filter answers "does this subscriber care about this event"; a guard answers "is this
subscriber allowed to know". Conflating them leaks data to the wrong subscriber, and the leak is quiet — a
filter with a bug delivers, it does not throw.

Ordering follows: the guard runs first (§5), then the filter, then delivery. A filter returning `false` is not
an error, sends nothing, and does not count against the buffer. A guard returning `false` terminates.

Where a filter is tempting for authorisation — "only send events for posts this viewer owns" — the answer is
§2.1: put the identity in the topic name at subscribe time. Then the filter has nothing to protect.

## 10. What #552 has to assert

1. `delivers a published event to a subscribed client` — the happy path, end to end over a fake socket, with
   `next` framing checked.
2. `validates every payload before delivery` — a payload that fails the topic's validator produces an `error`
   for that operation and never a `next`; and `TopicValidators<M>` missing a topic fails to compile
   (type-test).
3. `re-authorises on the reauthMs boundary and not before` — a guard call count of 1 across several events
   inside the window, and 2 after it, with fake timers.
4. `terminates the operation when a guard fails mid-stream, and leaves the socket open` — `error` with
   `FORBIDDEN`, `complete`, and a second operation on the same connection still receiving.
5. `does not deliver to a filtered-out subscriber, and the filter cannot see the context` — the behaviour, plus
   a type-test that `filter` has exactly two parameters.
6. `terminates a subscriber that exceeds the buffer bound` — a consumer that never pulls, 65 publishes,
   `SUBSCRIPTION_OVERFLOW`, and the publisher's `publish` resolving promptly throughout (the head-of-line
   property, asserted as a completed promise rather than as a duration).
7. Four cleanup tests, one per §6 row, each asserting `subscriberCount() === 0` and `connectionCount() === 0`
   afterwards — including `app.dispose()` with a live connection.
8. `sseStream closes its source when the stream is cancelled` — §6.1, the shipped leak.
9. `two apps in one process do not share subscribers` — publish on app A, assert nothing arrives on app B
   (ARCHITECTURE.md §2.7).
10. `refuses a connection whose init payload does not authenticate` — close code 4403, and no `connection_ack`.
11. `closes an uninitialised connection after initTimeoutMs` — 4408, with fake timers.
12. `rejects a duplicate operation id` — 4409, and the first operation still live.
13. `serves a query over the socket with the same chain as over HTTP` — one `next`, one `complete`, and the
    guard ran.
14. `there is no Subscription event-binding export` — §3's rename, over `verify:exports`, plus `EventBinding`
    present.
15. `a subscription context carries a signal and operation: 'subscription'` — type-test, including that
    `GqlCtx`'s widened `operation` still narrows for a query.

## Non-goals (rejected)

- **No broker.** §1 — an adapter over two methods. The epic's own non-goal, and `LISTEN/NOTIFY` versus Redis
  is a deployment decision with real trade-offs the docs page already lays out.
- **No socket server, and no `ws` dependency.** §8 — `gateways/SPEC.md` already put it out of scope, and the
  reason `POST /graphql` is the app's applies unchanged.
- **No `graphql-sse`.** §8 — it needs a streaming `WebResponse.body`, which is the responses epic. Named as a
  successor rather than left implicit.
- **No generic `publish<T>`/`subscribe<T>` on `PubSub`.** §1 — a caller-chosen type parameter over a process
  boundary is an assertion, not a check.
- **No unbounded buffer, and no option for one.** §7 — one connection that stops reading would be enough.
- **No drop-oldest on overflow.** §7 — a subscription payload has no sequence number, so a silently
  incomplete stream is undetectable by the client.
- **No publisher-side backpressure.** §7 — the slowest subscriber would set the rate for the whole system.
- **No subscribe-time-only authorisation as the default.** §5 — unbounded exposure after revocation. Reachable,
  spelled out, so it reads as a decision.
- **No per-event authorisation as the default either.** §5 — it points a fan-out amplifier at your own
  database.
- **No context on `filter`.** §9 — the one thing that makes "a filter is not authorisation" structural.
- **No skipping an event when a guard fails.** §5 — indistinguishable from a quiet topic, so the client never
  learns.
- **No `returns` thunk on `@Subscription`.** §3 — `../SPEC.md` §1's refusal, unchanged.
- **No subscription in the emitted SDL from a table type alone.** A `Subscription` root is declared as fields
  (`sdlFields<F>`), like `Query` and `Mutation`, because a subscription's payload is an event shape and not a
  row — even when the two currently coincide.
