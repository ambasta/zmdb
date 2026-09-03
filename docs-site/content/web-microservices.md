> **ToDo / feature gap.** There is no transport-strategy layer yet — no
> `@MessagePattern`, no message dispatcher, no broker adapters and no gRPC
> binding.
>
> The shape it will ship as is frozen in
> `packages/web/src/microservices/SPEC.md` (brokers) and
> `packages/web/src/microservices/grpc/SPEC.md` (gRPC), and this page and the
> three below it have been aligned to it.

## The seam that already exists

zmdb's [pipeline is transport-agnostic](./web-pipeline.html): `createRouter` produces a handler that adapters ([Node](./web-pipeline.html), [Fetch](./web-pipeline.html)) feed. A message transport is another adapter over the same container and the same lifecycle.

Two things this page used to say about that seam are wrong, and the freeze corrects both.

**A message transport does not turn a broker message into "the same `Ctx` the HTTP path uses".** It cannot. A `Ctx` has `method` and `path`, and a message off a broker has neither, so reusing it means inventing values for both — after which every guard anyone has written becomes silently applicable to messages and silently false. `ctx.path.startsWith('/admin')` compiles, runs, returns `false` for every message, and an authorisation check that was protecting a route stops protecting anything with no error anywhere. So `MessageContext<T>` is a **sibling** of `Ctx`, not a subtype, and what the two share is spelled structurally:

```ts
type WithHeaders = { readonly headers: Readonly<Record<string, string>> };

function requiresApiKey(ctx: WithHeaders): boolean {
  return ctx.headers['x-api-key'] === env.API_KEY;
}
```

`Ctx`, a GraphQL context, a `MessageContext` and a `GrpcCall` all satisfy that with no `extends` on any of them, no cast and no edit to a file the microservices layer does not own. One authorisation _function_ serves all four; the guard _interfaces_ stay separate.

**`@Subscribe` is not the pattern-matching primitive.** That name belongs to [gateways](./web-gateways.html), where a `Subscription` is a WebSocket event binding, and reusing it would give one word three meanings in one package. Messages get `@MessagePattern` and `@EventPattern`.

## What the freeze decided

The interesting decisions are all about failure, because dispatch is a `Map.get`.

- **The handler never acknowledges.** There is no `ack()` on the context. A handler returns, and the dispatcher turns that into a settlement the transport applies. Forgetting to ack is the classic broker-consumer bug — the message runs, succeeds, and is redelivered anyway — and a return type makes it unwritable.
- **Three outcomes, not two.** `ack`, `retry` with a required delay, or `dead` with a reason. `nack(requeue: true)` is not in the API at any level: it returns the message to the head of the queue immediately, so a deterministic failure re-receives it in microseconds forever.
- **An invalid payload is always `dead`.** Never retried, on any transport, with no option to change it — a validator is deterministic and compiled ahead of time, so a payload that failed it will fail it again on every redelivery. That is a guaranteed non-terminating loop, not a risk.
- **A transport declares what it cannot do.** Redis pub/sub has no acknowledgement, no redelivery and no dead-letter destination, so `retry` on it is a **drop**. `capabilities.redelivery` is `false` there, and constructing a dispatcher over such a transport without an `onUndeliverable` sink throws at construction rather than losing the first failed message quietly.
- **Timeouts are required, with no default.** Both for a request/response call and for the shutdown grace period. A default would be a number the framework guessed for a broker it has never seen.

## What ships, and what is deferred with a reason

Redis, NATS and RabbitMQ strategies, each an optional peer dependency. Kafka and MQTT are deferred, and the reasons are properties of the interface rather than a shortage of time:

- **Kafka** commits offsets, and an offset acknowledges everything up to it. "This one message is dead while its predecessor is still in flight" is not expressible, so per-message settlement has no meaning there.
- **MQTT** chooses QoS per subscription, not per message, and the broker redelivers on its own schedule. `retry` with a delay has no analogue, and a strategy that silently ignored the delay would be worse than one that does not exist.

No TCP transport. A hand-rolled length-prefixed JSON socket is the one transport where "bring a broker" is strictly better advice than "use ours".

## Before you split

The strongest recommendation here, unchanged by any of the above: most applications that adopt microservice transports would be better as one deployable. A service boundary buys independent scaling and independent failure, and costs you transactions, joins, atomic reads and a debugging story. If you split, split where you genuinely never need a transaction across the seam.

## Cross-links

- [Broker Transports](./web-microservices-transports.html) · [gRPC](./web-microservices-grpc.html) · [Custom Transports](./web-microservices-custom-transport.html)
- [Request pipeline & adapters](./web-pipeline.html) · [WebSockets & SSE](./web-gateways.html)
