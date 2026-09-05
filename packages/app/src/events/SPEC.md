# SPEC — application events: typing, isolation, and why there are two buses (frozen)

Part of `@zmdb/app`, a new `./events` subpath. `../../../repository/src/entity-modeling/` owns entity lifecycle events; this file owns application events, and §1 is why those are not the same thing.

The decisions that matter here are all about failure, because an event emitter's happy path is a `for` loop. What a handler's exception does, whether the emitter's caller waits for it, and whether two
handlers can rely on running in order are the three questions that make an emitter either dependable or a source of intermittent bugs, and all three have a default that looks harmless and is wrong.

## 1. Two buses, and why unifying them would break one of them

`#592` step 1 asks whether to unify with the existing `EventBus` and to "say plainly why there are two things". They do **not** unify, and the reason is sharper than a difference of scope.

`EventBus` (`../../../repository/src/entity-modeling/index.ts:17-31`) is real and public via the `@zmdb/repository/entity-modeling` subpath. Its `emit` is:

```ts
async emit(event: LifecycleEvent, ctx: unknown): Promise<void> {
  for (const s of this.subs) {
    if (s.on === event) await s.run(ctx);
  }
}
```

Sequential, awaited, and with **no try/catch** — so a throwing subscriber stops the remaining subscribers and rejects the caller, which is the repository write.

|                       | `EventBus` (`@zmdb/repository/entity-modeling`)     | `Events<M>` (`@zmdb/app/events`)        |
| --------------------- | --------------------------------------------------- | --------------------------------------- |
| what an event is      | one of six fixed `LifecycleEvent` strings           | any key of the application's `EventMap` |
| payload type          | `unknown`                                           | `M[K]`                                  |
| when it fires         | inside a repository write                           | wherever the application calls it       |
| ordering              | registration order, sequential                      | concurrent, unordered (§4)              |
| a throwing handler    | aborts the remaining handlers and rejects the write | isolated and reported (§3)              |
| already transactional | yes — it runs inside the write                      | only via `emitInTransaction` (§5)       |

**The decisive row is the failure row, and the two correct behaviours are opposites.** A `beforeCreate` subscriber that throws _should_ abort the write — that is how a validation veto is expressed,
and it is the only reason to hook `beforeCreate` at all.

An application-event handler that throws must _not_ abort the request that emitted it, because a failing cache invalidation is not a reason to fail a checkout. `docs-site/content/web-events.md` states
the second half already: "Without it, one throwing listener stops the rest, so a broken metrics listener breaks the request that triggered it."

Unifying them means picking one behaviour, and either choice makes the other use case wrong. That is a better argument than "different scopes", and it is why `docs-site/pages.mjs`'s note for the page
— "EventBus covers entity lifecycle only" — is accurate rather than a placeholder.

**How a user chooses**, in one line each:

- The event is a fact about a row, and a subscriber may **veto** it → `EventBus`.
- The event is a fact about the application, and a subscriber must not be able to break the emitter → `Events<M>`.
- The event must survive a crash → neither. `emitInTransaction` (§5), which is the outbox.

`Subscriber.run(ctx: unknown)` being untyped is a genuine gap in `EventBus` and is **not** fixed here. It belongs to `entity-modeling/SPEC.md`, and closing it from this side would mean a second walker
over the same concept.

## 2. The event map, not an event token

```ts
export interface EventMap {
  readonly [event: string]: unknown;
}

export interface Events<M extends EventMap> {
  emit<K extends keyof M & string>(event: K, payload: M[K]): void;
  emitAndWait<K extends keyof M & string>(event: K, payload: M[K]): Promise<EmitReport>;
  on<K extends keyof M & string>(event: K, handler: (payload: M[K]) => void | Promise<void>): () => void;
  bind(instance: object): () => void;
  emitInTransaction<K extends keyof M & string>(tx: TransactionContext, event: K, payload: M[K]): Promise<string>;
}

export declare function createEvents<M extends EventMap>(opts: EventsOptions<M>): Events<M>;

export interface EventsOptions<M extends EventMap> {
  readonly onError: (failure: EventFailure) => void;
  readonly validate?: { readonly [K in keyof M]?: (raw: unknown) => M[K] };
  readonly outbox?: (tx: TransactionContext) => OutboxWriter;
}
```

**`EventType<T>` is refused**, and for the reason `subscriptions/SPEC.md` §1 refused `publish<T>`: a token whose `T` the caller supplies is an unchecked assertion wearing a generic.
`OnEvent<T>(event: EventType<T>)` lets a handler declare a payload type the emitter never agreed to, and the two compile independently. The map is a single declaration both sides are checked against,
it is what `docs-site/content/web-events.md` recommends (`type AppEvents = { 'post.published': { id: number } }`), and it needs no runtime object per event.

`validate` is **optional and per event**, unlike `subscriptions/SPEC.md`'s `TopicValidators<M>`, which is total. The asymmetry is deliberate: a subscription payload crosses a process boundary and is
therefore untrusted, while an application event is emitted by this process from a value the type checker already saw. Validating it would be checking our own work. The entries exist for the one case
where that is not true — an event re-emitted from a broker or a webhook, where the payload really did arrive as `unknown`.

## 3. A handler's exception is data, not control flow

Every handler runs inside its own `try`/`catch`. A failure becomes an `EventFailure` and is **collected**, not thrown:

```ts
export interface EventFailure {
  readonly event: string;
  readonly handler: string;
  readonly error: unknown;
}

export interface EmitReport {
  readonly delivered: number;
  readonly failures: readonly EventFailure[];
}
```

**Rethrowing the first failure is refused.** With handlers running concurrently (§4) "the first" is a race, so an emitter that rethrows makes its caller's outcome depend on which handler happened to
reject first — the kind of nondeterminism that reproduces once a week. Collecting every failure also means a report has the same shape whether one handler failed or all of them, so a caller that wants
to escalate can, deliberately, on evidence.

**`onError` is required**, and that is the one piece of friction in this file worth defending. There are two alternatives and both are worse. Swallowing by default makes a broken handler invisible,
which is the exact bug `web-events.md` warns about with the emphasis reversed.

Defaulting to `console.error` — which the page's example does — hard-codes a logger into a package that has deliberately never had one, and cannot be asserted against in a test without capturing
global console state. Requiring the sink means the question "where does a failed handler go?" is answered at construction, once, by the person who knows.

`error` is `unknown` because a `throw` can be anything. Narrowing it to `Error` in the type would be a claim the runtime cannot keep.

## 4. `emit` does not wait, `emitAndWait` does, and the name is the documentation

`#592` step 2 asks whether `emit` awaits its handlers and notes that awaiting "makes an event emitter a synchronous fan-out with the latency of its slowest handler, which surprises people". Both
answers are legitimate, so **both exist and the choice is in the method name**:

| Call                | Returns               | Use when                                                     |
| ------------------- | --------------------- | ------------------------------------------------------------ |
| `emit(e, p)`        | `void`                | the emitter's caller must not pay for the handlers           |
| `emitAndWait(e, p)` | `Promise<EmitReport>` | the outcome is needed — a test, a job step, a shutdown flush |

`emit` returning `void` rather than an ignored `Promise` is the point. `web-events.md` recommends `void this.events.emit(…)` and says "`void` here means 'I have decided a failure is acceptable'" — but
a `void` operator is indistinguishable from a forgotten `await`, and it is the same keystroke either way. A method that returns `void` cannot be awaited by mistake and cannot produce an unhandled
rejection, and the decision is legible in the call rather than in a discarded expression.

A boolean option — `emit(e, p, { wait: true })` — is refused for the ordinary reason: the return type would have to be the union of both, so every caller narrows a result whose shape it already knew
statically.

## 5. Crossing into the outbox

```ts
emitInTransaction<K extends keyof M & string>(tx: TransactionContext, event: K, payload: M[K]): Promise<string>;
```

Available on an `Events<M>` constructed with an outbox writer. It does **not** call any in-process handler: it writes one outbox row through the caller's transaction and returns its id.

That is the whole of the guarantee and the whole of the surprise, so it is stated in both directions: an event emitted this way is delivered **after** the transaction commits, by the dispatcher,
possibly more than once, and possibly in a different process — and is not delivered at all if the transaction rolls back.

An in-process handler registered for the same event name does not see it. Two delivery paths that look like one call is how an application ends up with a handler that fires in tests and never in
production, so the method is separate and the asymmetry is named here rather than discovered.

`TransactionContext` (`../../../repository/src/transactions/index.ts:8-12`) is the real type; `#592` calls it `Transaction`, which does not exist. The semantics, the table and the dispatcher are
`../../../query-compiler/src/outbox/SPEC.md`, and nothing about them is restated here.

## 6. `@OnEvent`, and what a decorator actually buys

```ts
export declare function OnEvent(event: string): (target: Function, context: ClassMethodDecoratorContext) => void;
export declare function getEventHandlers(cls: abstract new (...args: never[]) => unknown): readonly ResolvedEventHandler[];
export interface ResolvedEventHandler {
  readonly event: string;
  readonly handlerName: string;
}
```

`MethodDecorator` does not exist under Stage 3; the shape is `(target, context: ClassMethodDecoratorContext)`, the same correction `../graphql/SPEC.md` §13 and `subscriptions/SPEC.md` §3 record.

`ResolvedEventHandler` mirrors `ResolvedRoute` (`../../../web/src/routing/index.ts`) rather than reusing `EventBinding` — which is now the gateways type, renamed there by `#551`. Two
`{ event, handlerName }` shapes with different owners is worth the duplication; a shared name across `./gateways` and `./events` would tie a WebSocket binding and a domain-event binding together for
no reason but their fields.

**Nothing scans.** `getEventHandlers(cls)` takes the class, exactly as `getRoutes` (`../../../web/src/routing/index.ts`) and `getSubscriptions` (`../../../web/src/gateways/index.ts`) do, and
`bind(instance)` registers that instance's handlers and returns one function that unregisters all of them. `docs-site/content/web-discovery.md` is unambiguous — "Nothing scans the filesystem, nothing
reads decorator metadata at runtime to find providers" — and this is consistent with it rather than an exception to it.

`web-events.md` says explicit registration makes the decorator pointless: "subscriptions would have to be registered explicitly, at which point the class above is the feature." That overstates the
case. The decorator does not provide discovery; it keeps the binding on the method instead of inside a lifecycle hook.

Today the only place to call `.on(…)` is `onModuleInit`, and a class whose handler exists but whose `onModuleInit` forgot the `.on(…)` line is silently never invoked — there is nothing to notice,
because the method is still there and still typed. `bind(this)` in `onModuleInit` is one line that cannot be partially wrong: either every decorated handler is registered or none is.

That is a modest benefit, and `on` therefore stays public and first-class. An application that prefers the plain class in `web-events.md` loses nothing, and this file does not claim otherwise.

## 7. Handlers run concurrently, and no order is guaranteed

`Promise.allSettled` over the event's handlers. Not registration order, and not sequential.

Two reasons, and the second is the one that matters. Sequentially awaiting makes the emitter's latency the **sum** of its handlers' latencies, so adding a handler slows down an unrelated caller —
which is `EventBus`'s behaviour and is defensible only because a lifecycle veto needs it.

And running in a defined order creates a dependency nobody declared: two handlers work, someone reorders the registrations, and one breaks. Concurrency makes the non-guarantee _true at runtime_ rather
than documented and accidentally violated, which is the only kind of non-guarantee that survives.

`allSettled` rather than `all` is what gives §3 its isolation with no extra machinery: a rejection cannot short-circuit the others because `allSettled` has no short circuit.

An application that needs step B after step A does not need ordered handlers. It needs one handler that does A then B, which says the dependency in the place that has it.

## 8. In-process, and not pretending otherwise

`Events<M>` reaches handlers in **this** process. It is a provider on the container, not a module-level singleton, so two apps in one process do not share handlers — the same rule
`subscriptions/SPEC.md` §1 applies to `createMemoryPubSub`, for the same reason, and it is what makes `#593`'s assertions independent of test order.

With more than one replica, an in-process event reaches one of them. `web-events.md` already documents that, names the failure ("a bug that only appears in production, because development runs one
process") and gives the two candidate answers; neither ships here, and the reliable cross-instance path is `emitInTransaction` plus a dispatcher, which is §5.

## 9. What #593 has to assert

1. `a throwing handler does not prevent the others` — three handlers, the middle one throws, the other two ran.
2. `a throwing handler does not reject emitAndWait` — the report carries the failure; the promise resolves.
3. `every failure reaches onError exactly once` — two failing handlers, two calls, and the `handler` field names the right method.
4. `emit returns void and never rejects` — a type-test that `emit(…)` is not awaitable, plus a runtime assertion that a throwing handler produces no unhandled rejection.
5. `handlers run concurrently` — two handlers each resolving on the other's flag, which deadlocks under any sequential implementation. This is the assertion that pins §7 rather than describing it.
6. `binding an event the map does not declare is a compile error` — type-test, both on `on` and on the payload.
7. `bind registers every decorated handler and its disposer unregisters all of them` — §6, asserting the count before and after.
8. `getEventHandlers reads the class, not an instance` — and returns `[]` for an undecorated class.
9. `emitInTransaction calls no in-process handler` — §5, the asymmetry that would otherwise be found in production.
10. `emitInTransaction's row is gone after a rollback` — cross-referenced to the outbox spec's assertion rather than duplicated; this one asserts the `Events<M>` path reaches it.
11. `validate is applied when present and skipped when absent` — §2, including that a rejected payload becomes an `EventFailure` rather than a throw.

## Non-goals (rejected)

- **No unification with `EventBus`.** §1 — the two have opposite correct behaviour when a handler throws, so one of them would have to become wrong.
- **No fix to `EventBus`'s missing try/catch or its `ctx: unknown`.** §1 — both belong to `entity-modeling/SPEC.md`, and the veto semantics mean the missing try/catch is arguably correct there.
- **No `EventType<T>` token.** §2 — a generic the caller instantiates is an assertion, and the map already checks both sides.
- **No default `onError`.** §3 — silence hides the documented bug and `console.error` invents a logger this project has deliberately never had.
- **No rethrow of the first handler failure.** §3 — with concurrent handlers, "first" is a race.
- **No `wait` option on `emit`.** §4 — a union return type makes every caller narrow something it knew statically. Two methods, two names.
- **No ordered or sequential handlers, and no priorities.** §7 — an ordering guarantee is a dependency the application should express as one handler.
- **No wildcard or namespaced event names.** `'post.*'` needs a matcher, a precedence rule between a wildcard and an exact match, and a story for what a wildcard handler's payload type is. `keyof M`
  has none of those questions and answers the common case.
- **No once-only handlers and no handler removal by identity.** The disposer returned from `on` and `bind` is the whole removal mechanism, and it cannot be called for the wrong handler.
- **No cross-instance transport.** §8 — `LISTEN/NOTIFY` and Redis are both documented in `web-events.md` as lossy, and the non-lossy answer is the outbox.
- **No filesystem or metadata discovery.** §6 — `web-discovery.md`, unchanged.

## Package ownership amendment (#645)

The entire in-process event contract moves to `@zmdb/app/events`: `createEvents`, `OnEvent`, `getEventHandlers`, `EventMap`, `EventFailure`, `EmitReport`, `EventsOptions`, `Events` and
`ResolvedEventHandler`.

Its repository/outbox crossing remains an inward workspace dependency, not an HTTP dependency. The old `@zmdb/web/events` path and implementation are deleted; no facade may wrap the registry or change
handler identity.
