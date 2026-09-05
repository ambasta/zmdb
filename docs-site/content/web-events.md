Application events ship from `@zmdb/app/events` as an app-owned typed registry. There is no module-level singleton and no filesystem scan: construct one `Events<M>` per application, register handlers
explicitly, and choose in the method name whether the caller waits.

## Pick the delivery guarantee first

The question to ask first is whether the event may be lost. That answer picks the mechanism, and getting it wrong is the actual bug — not the missing module.

**If the event must not be lost, use the [transactional outbox](./transactional-outbox.html).** It is the shipped answer for anything that triggers work elsewhere.

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';
import { outboxWriter } from '@zmdb/repository/outbox';
import { createToken } from '@zmdb/app/di';
import { createEvents, OnEvent, type Events } from '@zmdb/app/events';

type AppEvents = {
  'post.published': { id: number };
  'user.registered': { id: number; email: string };
};

const events = createEvents<AppEvents>({
  onError: failure => process.stderr.write(`${failure.event}:${failure.handler}:${String(failure.error)}\n`),
  outbox: outboxWriter,
});
const EVENTS = createToken<Events<AppEvents>>('EVENTS');

const db = createTransactionalDb(connection);

await db.transaction(async tx => {
  await postRepo.withTransaction(tx).update(id, { published: true });
  await events.emitInTransaction(tx, 'post.published', { id });
});
```

`repo.withTransaction(tx)` returns a **new repository bound to the transaction's connection**. `outboxWriter` takes that same transaction as its only constructor argument, and `emitInTransaction`
serialises the payload and delegates to it. No in-process handler runs on this path.

The state change and the event commit together or not at all. An in-memory emitter cannot give you that — the process can die between the commit and the emit, and the event is gone with no trace. This
is the failure mode that makes emitter-based side effects unreliable in a way that is invisible in testing.

**If losing it is fine — cache invalidation, a metric, a debug log — emit in process:**

```ts
const off = events.on('post.published', async ({ id }) => {
  await cache.invalidate(`post:${id}`);
});

events.emit('post.published', { id: 7 }); // returns void

const report = await events.emitAndWait('post.published', { id: 8 });
console.log(report.delivered, report.failures);

off();
```

A type alias and not an `interface` matters here: only object-literal aliases get an implicit index signature, so `interface AppEvents` does not satisfy the `M extends EventMap` constraint. A
misspelled event name or the wrong payload is a compile error.

Handlers start together. One rejection does not stop its siblings; each failure is delivered once to the required `onError` sink and appears in the `emitAndWait` report.

## Register it as a provider

```ts
@Module({
  providers: [{ token: EVENTS, useValue: events }],
  controllers: [PostsController],
})
export class AppModule {}
```

```ts
@Controller('/posts')
export class PostsController {
  @Inject(EVENTS) private readonly events!: Events<AppEvents>;

  @Post('/:id/publish')
  async publish(ctx: Ctx<{ id: string }>) {
    const post = await this.repo.update(Number(ctx.params.id), { published: true });
    this.events.emit('post.published', { id: post.id });
    return post;
  }
}
```

`EVENTS` is a normal typed token created with `createToken<Events<AppEvents>>('EVENTS')`. Subscribe in a controller or provider startup hook. The emitter has no lifecycle of its own; the owning
application decides where registration and disposal happen:

```ts
private disposeEvents = (): void => undefined;

onModuleInit() {
  this.disposeEvents = this.events.bind(this);
}

onShutdown() {
  this.disposeEvents();
}

@OnEvent('post.published')
async invalidate({ id }: { id: number }) {
  await this.cache.invalidate(`post:${id}`);
}
```

`@OnEvent` records declarations; it does not discover or instantiate the class. `bind(this)` reads those declarations, binds methods to the instance, and returns one idempotent disposer.

## Waiting is explicit

```ts
this.events.emit('post.published', { id }); // caller does not wait
const report = await this.events.emitAndWait('post.published', { id }); // caller waits
```

`emit` itself returns `void`, so it cannot produce an unhandled rejection or be accidentally awaited. `emitAndWait` resolves only after every handler settles and returns `{ delivered, failures }`;
handler failures are data, not control flow. Neither call gives handlers an ordering guarantee.

## Application events are not repository lifecycle events

`EventBus` from `@zmdb/repository/entity-modeling` is a different boundary with deliberately opposite failure semantics. It runs matching lifecycle subscribers sequentially, stops on the first
failure, and lets that failure reject the explicit repository override that emitted it. Use it for a `beforeCreate` veto or another hook that is part of the write itself.

Use `Events<M>` for application facts whose independent handlers must all get a chance to run. Its handlers run concurrently and one failure is reported without stopping the others. If the fact must
survive a rollback, process exit, or another replica, write it through `emitInTransaction` and the outbox instead. The [lifecycle hooks page](./lifecycle-hooks.html) shows the explicit repository
override and the point where each API belongs.

## In-process events do not cross instances

An emitter reaches listeners in **this** process. With more than one replica, a cache invalidation event invalidates one instance's cache and leaves the others stale — a bug that only appears in
production, because development runs one process.

For cross-instance events you need a transport: Postgres `LISTEN/NOTIFY`, Redis pub/sub, or the outbox plus a consumer. `LISTEN/NOTIFY` is attractive here because you already have the connection:

```ts
await driver.execute({ text: `NOTIFY post_published, $1`, parameters: [String(id)] });
```

It is still lossy — a listener that is not connected misses it — so use it for invalidation, not for work that must happen. Work that must happen goes in the outbox or in a job row, both of which
survive a listener being disconnected; the consumer half ships as `createWorker` in `@zmdb/jobs`, with its delivery contract recorded in `packages/jobs/src/queues/SPEC.md`.

## The shipped contract

Four decisions in `packages/app/src/events/SPEC.md` are worth keeping visible:

- **The map is the API** — event name to payload, the shape `AppEvents` above has, declared as a `type` and not an `interface` so it satisfies `EventMap`'s index signature. No `EventType<T>` token — a
  generic the caller instantiates is an assertion, not a check.
- **`emit` returns `void` and `emitAndWait` returns a report.** No `void this.events.emit(…)` idiom is necessary, because a `void`-returning method cannot be awaited by mistake. A `void` _operator_ is
  indistinguishable from a forgotten `await`, and it is the same keystroke either way.
- **Failures are collected, not logged and not thrown.** Every handler settles independently, the failures land in an `EmitReport`, and the sink is a **required** `onError`. Defaulting it to
  `console.error` would put a logger inside a package that has [deliberately never had one](./web-logging.html).
- **Handlers run concurrently**, so no ordering is guaranteed. Awaiting them in sequence makes the emitter's latency the sum of its handlers' and creates an ordering dependency nobody declared.

The decorator buys declaration, not discovery. `bind(this)` registers every decorated method in one call; `on` remains first-class when a plain callback is clearer.

The outbox dispatcher now ships. Its `publish` callback remains at-least-once, so consumers still need an idempotency rule. For durable in-process jobs, the queue worker supplies a stable key and
checks the handler-owned completion marker before invoking work.

---

See also: [Lifecycle Hooks](./lifecycle-hooks.html) · [Transactional Outbox](./transactional-outbox.html) · [CQRS](./web-cqrs.html) · [Queues](./web-queues.html)
