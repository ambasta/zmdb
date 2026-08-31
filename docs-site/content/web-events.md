> **ToDo / feature gap.** There is no event emitter — no `EventEmitterModule`, no
> `@OnEvent`, no `EventEmitter2` wrapper. The only event-shaped thing in the
> project is [`@Subscribe`](./web-gateways.html), which dispatches WebSocket
> messages, not domain events.

## What to use instead, and why it is usually better

The question to ask first is whether the event may be lost. That answer picks the mechanism, and getting it wrong is the actual bug — not the missing module.

**If the event must not be lost, use the [transactional outbox](./transactional-outbox.html).** It is built, and it is the right answer for anything that triggers work elsewhere:

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';

const db = createTransactionalDb(connection);

await db.transaction(async tx => {
  await postRepo.withTransaction(tx).update(id, { published: true });
  await outboxRepo.withTransaction(tx).create({ type: 'post.published', payload: { id }, at: new Date() });
});
```

`repo.withTransaction(tx)` returns a **new repository bound to the transaction's connection** — every repository taking part has to be rebound. The original instances still hold the pooled driver, so `outboxRepo.create(…)` inside the callback would commit on its own connection and the atomicity would be a fiction that reads exactly like the correct code.

The state change and the event commit together or not at all. An in-memory emitter cannot give you that — the process can die between the commit and the emit, and the event is gone with no trace. This is the failure mode that makes emitter-based side effects unreliable in a way that is invisible in testing.

**If losing it is fine — cache invalidation, a metric, a debug log — a plain array does the job:**

```ts
type Listener<T> = (payload: T) => void | Promise<void>;

export class Emitter<Events extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof Events, Listener<never>[]>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const list = this.#listeners.get(event) ?? [];
    list.push(listener as Listener<never>);
    this.#listeners.set(event, list);
    return () => {
      const i = list.indexOf(listener as Listener<never>);
      if (i >= 0) list.splice(i, 1);
    };
  }

  async emit<K extends keyof Events>(event: K, payload: Events[K]): Promise<void> {
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        await (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        console.error(JSON.stringify({ event: String(event), error: String(error) }));
      }
    }
  }
}
```

```ts
export interface AppEvents {
  'post.published': { id: number };
  'user.registered': { id: number; email: string };
}

export const EVENTS = createToken<Emitter<AppEvents>>('EVENTS');
```

Typed by an interface, so `emit('post.publshed', …)` is a compile error and the payload shape is checked. The two casts are contained in the class — the same heterogeneous-map problem as [CQRS](./web-cqrs.html), and the reason a generic bus is not in the framework.

Note the `try/catch` per listener. Without it, one throwing listener stops the rest and rejects the emitter's caller, so a broken metrics listener breaks the request that triggered it.

## Register it as a provider

```ts
@Module({
  providers: [{ token: EVENTS, useValue: new Emitter<AppEvents>() }],
  controllers: [PostsController],
})
export class AppModule {}
```

```ts
@Controller('/posts')
export class PostsController {
  @Inject(EVENTS) private readonly events!: Emitter<AppEvents>;

  @Post('/:id/publish')
  async publish(ctx: Ctx<{ id: string }>) {
    const post = await this.repo.update(Number(ctx.params.id), { published: true });
    await this.events.emit('post.published', { id: post.id });
    return post;
  }
}
```

Subscribe in a controller's `onModuleInit`, since that is [the only lifecycle hook that runs](./web-standalone.html):

```ts
async onModuleInit() {
  this.events.on('post.published', ({ id }) => this.cache.invalidate(`post:${id}`));
}
```

## Do not `await` a fire-and-forget listener in the request path

```ts
await this.events.emit('post.published', { id }); // request waits for every listener
```

That is often what you want — errors surface and ordering is defined. But if a listener sends an email, the user waits for SMTP. Either move the slow work to a queue, or emit without awaiting and accept that a failure is only a log line:

```ts
void this.events.emit('post.published', { id });
```

Be deliberate. `void` here means "I have decided a failure is acceptable", and it should be a decision rather than an oversight.

## In-process events do not cross instances

An emitter reaches listeners in **this** process. With more than one replica, a cache invalidation event invalidates one instance's cache and leaves the others stale — a bug that only appears in production, because development runs one process.

For cross-instance events you need a transport: Postgres `LISTEN/NOTIFY`, Redis pub/sub, or the outbox plus a consumer. `LISTEN/NOTIFY` is attractive here because you already have the connection:

```ts
await driver.execute({ text: `NOTIFY post_published, $1`, parameters: [String(id)] });
```

It is still lossy — a listener that is not connected misses it — so use it for invalidation, not for work that must happen.

## What it would take

The typed emitter above is most of it; making it a framework module means solving the dispatch typing generically (the `Map<keyof Events, …>` casts) and deciding on `@OnEvent` discovery, which conflicts with [there being no discovery](./web-discovery.html) — subscriptions would have to be registered explicitly, at which point the class above is the feature.

The more useful thing to build is an outbox _consumer_: a loop that polls the outbox table, dispatches, and marks rows done with at-least-once delivery. That is the part applications actually rewrite each time.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [CQRS](./web-cqrs.html) · [Queues](./web-queues.html)
