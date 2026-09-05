# SPEC — CQRS: what a command bus has to earn (frozen)

Part of `@zmdb/web`; the `./cqrs` subpath ships a **command** bus only. The query bus, event sourcing and sagas are refused, each with a reason, in §6 — and recording those as decisions rather than
omissions is `#592` step 5.

The framing matters, because CQRS in a typed codebase is mostly a naming convention. A command bus that only looks up a handler and calls it is a dispatch hop with no property the direct call lacked,
and it costs a stack frame plus the type safety you gave up to make the lookup dynamic.

So the question this file answers is not "what does a command bus look like" but **what does one do that a method call does not** — and there is exactly one accurate answer.

## 1. The one thing that earns the indirection

A command bus is worth having when it is the **single place** every write passes through, because that is where cross-cutting concerns can be applied once instead of remembered N times:

| Concern          | Without a bus                                    | With a bus                       |
| ---------------- | ------------------------------------------------ | -------------------------------- |
| input validation | at the top of every handler, or forgotten in one | one `validate` entry per command |
| authorisation    | at the top of every handler, or forgotten in one | one `authorise` hook             |
| transactionality | `withTransaction` inside every handler           | one wrapper                      |
| an audit trail   | nowhere, or per handler                          | one `onCommand`                  |

"Or forgotten in one" is the whole argument. A concern applied at N call sites has N chances to be missing, and the missing one is invisible — the handler still compiles, still runs, still returns the
right value for the inputs the test used. A choke point converts that from a review problem into a type error.

Everything else attributed to CQRS — separating reads from writes, naming intent, keeping controllers thin — this project already has by other means, and §6 says where.

## 2. The surface

```ts
export interface CommandMap {
  readonly [command: string]: { readonly input: unknown; readonly result: unknown };
}

export type CommandBus<M extends CommandMap> = {
  readonly [K in keyof M]: (input: M[K]['input']) => Promise<M[K]['result']>;
};

export type CommandHandlers<M extends CommandMap> = {
  readonly [K in keyof M]: (input: M[K]['input'], ctx: CommandRun) => Promise<M[K]['result']>;
};

export interface CommandRun {
  readonly command: string;
  readonly tx: TransactionContext | undefined;
}

export interface CommandBusOptions<M extends CommandMap> {
  readonly validate: { readonly [K in keyof M]: (raw: unknown) => M[K]['input'] };
  readonly authorise?: <K extends keyof M & string>(command: K, input: M[K]['input']) => Promise<void>;
  readonly onCommand?: (run: CommandOutcome) => void;
  readonly transaction?: (fn: (tx: TransactionContext) => Promise<unknown>) => Promise<unknown>;
}

export declare function createCommandBus<M extends CommandMap>(handlers: CommandHandlers<M>, opts: CommandBusOptions<M>): CommandBus<M>;
```

`CommandBus<M>` is a **mapped type, not a `dispatch` method.** `bus.publishPost(input)` is checked against the map by name; there is no `dispatch(command: string, input: unknown)` whose `unknown`
every handler has to re-narrow. Adding a key to `M` without adding a handler is a missing-property error, and adding a handler for a command the map does not declare is an excess-property error —
which is the closure property a registry keyed on strings cannot have.

**`validate` is total.** Every command must have an entry; `Partial` would let the one command that skips validation be the one that needed it, which is §1's whole point aimed at itself. A command
whose input needs no narrowing supplies the identity function, and writing that deliberately is the intended friction.

## 3. Commands are not classes

`#592` step 4 proposes:

```ts
export interface Command<Result> {
  readonly _result?: Result;
}
export declare function CommandHandler<C extends Command<unknown>>(command: new (...a: never[]) => C): ClassDecorator;
```

Both halves are refused.

`new (...a: never[]) => C` requires every command to be a **class**, because only a class has a constructor to pass. Nothing else in this project works that way: entities are interfaces refined with
intersection tags, DTOs are types, and `docs-site/content/web-cqrs.md` uses a type-alias map. Making commands the one place a runtime class is mandatory buys a lookup key that a string literal already
provides, and costs every command an `instanceof`-shaped identity that has to survive serialisation.

`readonly _result?: Result` is a phantom field. Empty values satisfy every instantiation, and `Command<A>` widens to `Command<unknown>`, so a `C extends Command<unknown>` constraint proves no useful
relationship between a command's data and its result. `#525` rejected the identical pattern for the same reason.

`ClassDecorator` is the legacy decorator type and does not apply under Stage 3 (`experimentalDecorators` is `false`). Its real spelling is `(target, context: ClassDecoratorContext)`.

**There is no decorator here at all.** A `@CommandHandler(X)` class exists to be _found_ by a scan, and nothing in this project scans (`web-discovery.md`). Once handlers are passed explicitly — which
they must be — the decorator adds a second declaration of the same fact, and the object literal already places the handler adjacent to its name.

## 4. The pipeline, in order

For `bus.k(raw)`:

1. `validate[k](raw)` — narrows to `M[k]['input']`, or throws. A validation failure never reaches the handler.
2. `authorise?.(k, input)` — **after** validation, because an authorisation rule reads fields (`input.postId`) and reading an unvalidated field is exactly the confusion the ordering prevents.
   Authorisation throws to deny; a boolean return would let a forgotten `if` around the call default to allow.
3. `transaction?.(tx => handler(input, { command: k, tx }))`, or `handler(input, { command: k, tx: undefined })`.
4. `onCommand?.(outcome)` — always, on success and on failure, before the bus rethrows.

```ts
export type CommandOutcome = { readonly command: string; readonly ok: true; readonly ms: number } | { readonly command: string; readonly ok: false; readonly ms: number; readonly error: unknown };
```

The bus **rethrows**. It does not convert a failure into a result union, because the caller is a controller whose error mapping already exists — `ExceptionFilter` (`../middleware/index.ts:27`) turns a
thrown value into a `WebResponse` — and giving writes a second error convention means every call site handles failures two ways. `onCommand` is observation, not handling, which is why it cannot
suppress.

`ms` is from the global `performance.now()`, matching `../bench/index.ts:67`. `node:perf_hooks` is imported nowhere in this project and is not introduced here.

## 5. Transactions are supplied, not assumed

`transaction` is optional and the bus never constructs one. If it is absent, `CommandRun.tx` is `undefined` and the handler manages its own — which is what a command that writes nothing, or writes
through two stores, needs.

When it is present the handler receives the `TransactionContext` (`../../../repository/src/transactions/index.ts:8-12`) and must use it: a repository joins the transaction via `withTransaction`
(`../../../repository/src/index.ts:135`), whose parameter is structural (`{ execute: Driver['execute'] }`), so a `TransactionContext` satisfies it with no new type. A handler that ignores `ctx.tx` and
writes through an ambient repository silently escapes the transaction, and **the bus cannot detect that** — stated here because it is the one way to hold this API wrongly and it produces no error.

An event emitted from inside a command belongs in the same transaction as the write, which is `emitInTransaction` (`../events/SPEC.md` §5) taking `ctx.tx`. That is the composition the two files are
shaped for, and it is the only reason `CommandRun` exposes `tx` at all rather than keeping it private to the wrapper.

## 6. What is cut, and why — so it is not re-proposed as an oversight

**No query bus.** Reads already have a home: repositories, and `withReplicas` already does the read/write split that CQRS's _C_ and _Q_ are named for (`web-cqrs.md`). A query bus over that adds a
dispatch hop whose only property is symmetry with the command bus. §1's argument does not transfer either — a read has no transactionality to centralise, and its authorisation is row-scoped filtering,
which lives in the query (`entity-filters.md`), not in a wrapper that has already lost the predicate.

**No event sourcing.** It is out of scope because an event-sourced write path replaces the repository rather than layering on it, which makes it a different persistence model and a different product,
not a `@zmdb/web` module.

**No sagas — yet, and for a concrete reason.** A saga's easy part is calling three steps in order; its hard part is the terminal state of a failure that cannot be compensated, which requires durable
per-step state, an attempt count and a retry schedule. A saga built on the in-process emitter loses all of that on restart — precisely when it is needed, because the restart is usually what
interrupted the saga.

The outbox (`../../../query-compiler/src/outbox/SPEC.md`) and queue worker now supply durable delivery and retries, but they do not invent the saga's state row or compensation contract. A saga is a
queue consumer with those two application-owned records, not a hidden arm of the command bus, and it can be specified separately without inventing durability twice.

**No `CommandBus` on the container as a required provider.** It is a value produced by `createCommandBus` and registered like any other provider. A framework-owned singleton would need a registration
API, and the mapped type is per-application by construction.

## 7. What #593 has to assert

1. `a command missing from handlers is a compile error` — type-test on `createCommandBus`.
2. `a handler for a command not in the map is a compile error` — type-test, the other direction.
3. `a handler's return type is checked against M[K]['result']` — type-test.
4. `validate runs before the handler and a rejected input never reaches it` — the handler is a spy with zero calls.
5. `validate must be total` — type-test: omitting one command's entry does not compile.
6. `authorise runs after validate and receives the narrowed input` — assert the argument identity, not just that it was called.
7. `a throwing authorise prevents the handler and rethrows` — §4 step 2.
8. `the bus rethrows the handler's error unchanged` — identity assertion on the thrown value, so the bus is not wrapping.
9. `onCommand fires on success and on failure` — two cases, `ok` correct in each, and the failure case asserts it fires _before_ the rethrow.
10. `onCommand cannot suppress a failure` — an `onCommand` that returns normally still leaves the bus throwing.
11. `the handler receives ctx.tx when transaction is supplied and undefined when it is not` — both cases.
12. `a rejecting handler rolls back` — through a recording fake `transaction`, asserting the wrapper's own rejection path rather than a real database.

## Non-goals (rejected)

- **No `dispatch(command, payload)`.** §2 — a string-keyed entry point loses the per-command input and result types the map already has.
- **No `Command<Result>` phantom marker.** §3 — an optional phantom field makes unrelated commands mutually assignable.
- **No class-based commands and no `@CommandHandler`.** §3 — a constructor is a lookup key this project does not need, and a decorator without a scan restates what the handlers object already says.
- **No partial `validate`.** §2 — the command that skips validation is the one that needed it.
- **No boolean-returning `authorise`.** §4 — a forgotten `if` around it would default to allow.
- **No result-union return.** §4 — a second error convention for writes only.
- **No middleware chain or interceptor array on the bus.** The four hooks are named and ordered; an open chain would make the order a per-application discovery. The HTTP lifecycle keeps pipes,
  interceptors and filters behind an explicit `runChain` call too (`docs-site/content/web-request-lifecycle.md`).
- **No query bus.** §6 — repositories plus `withReplicas` already are the read side.
- **No event sourcing.** §6 — a different persistence model.
- **No sagas.** §6 — deferred until durable step state exists, not refused.
- **No automatic transaction.** §5 — the bus never opens one the application did not supply.
- **No command retry.** A retried command needs idempotency, which is the command's own business; retrying an unknown write at the bus is how a charge happens twice.

## Package ownership amendment (#645)

The CQRS contract moves unchanged to `@zmdb/app/cqrs`: `createCommandBus`, `CommandMap`, `CommandBus`, `CommandHandlers`, `CommandRun`, `CommandOutcome` and `CommandBusOptions`.

It remains independent of HTTP middleware and jobs. `@zmdb/web/cqrs` is deleted with no compatibility export, and `zmdb/app/cqrs` aliases the direct package declarations exactly.
