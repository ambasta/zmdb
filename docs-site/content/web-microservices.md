> **ToDo / feature gap.** There is no `@nestjs/microservices` analogue — no
> built-in TCP/NATS/Kafka/gRPC transport strategies or `@MessagePattern`
> decorators.

## The seam that already exists

zmdb's [pipeline is transport-agnostic](./web-pipeline.html): `createRouter`
produces a handler that adapters ([Node](./web-pipeline.html),
[Fetch](./web-pipeline.html)) feed. A message-transport strategy would be another
**adapter** that turns broker messages into the same `Ctx` the HTTP path uses,
and `@Subscribe`-style handlers (already present for
[gateways](./web-gateways.html)) are the natural pattern-matching primitive.

## Why it's a ToDo

Each transport (NATS/Kafka/gRPC) is its own client + framing + backpressure
story. It's deferred, not rejected — the adapter boundary and the
`@Gateway`/`@Subscribe` model are the extension points.

## Cross-links

- [Request pipeline & adapters](./web-pipeline.html) · [WebSockets & SSE](./web-gateways.html)
