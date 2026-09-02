> **ToDo / feature gap.** There is no gRPC support — no `@GrpcMethod`, no proto
> loading, no client factory. There is also no protobuf support anywhere in the
> project; every serialization path is JSON.

## Why this is a larger gap than the other transports

gRPC is not just a transport. It brings a schema language (`.proto`), a code generator, HTTP/2 streaming and a wire format — and each of those overlaps something zmdb already does differently:

| gRPC                          | zmdb equivalent                                                   |
| ----------------------------- | ----------------------------------------------------------------- |
| `.proto` as the schema source | a TypeScript `interface` with tags                                |
| `protoc` code generation      | [derived DTOs](./type-derivation.html), no generation step        |
| protobuf wire format          | JSON, via `stringify`/`parse`                                     |
| Streaming RPC                 | blocked by the [string response body](./web-streaming-files.html) |

So a gRPC integration would mean two schema sources of truth, which is the specific problem the project's [type-derived design](./anti-patterns.html) exists to avoid. That tension is why this is not simply a missing adapter.

## What to use instead

**HTTP with an OpenAPI contract.** The closest available thing to gRPC's value proposition — a machine-readable interface definition that clients generate from:

```ts
const doc = toOpenApi(CONTROLLERS, { info: { title: 'Orders', version: '1.0.0' } });
```

Commit the document and diff it in CI, and you have the contract-change review that `.proto` files are prized for. Client generators exist for every language. See [OpenAPI Operations](./web-openapi-operations.html).

**Typed clients from shared types**, when both sides are TypeScript. Better than either gRPC or OpenAPI here, because there is no generation step and no drift:

```ts
// packages/contracts
export interface GetOrder {
  readonly id: number;
}
export type OrderRow = Entity<Order>;
```

```ts
const order = await client.post<OrderRow>('/orders.get', { id }, raw => assert<OrderRow>(raw));
```

The `assert<OrderRow>` is AOT-compiled from the same type the server uses, so the boundary is checked at full speed. That is genuinely comparable to protobuf's guarantees, without the wire format.

## Calling an existing gRPC service

Nothing stops you — bring a client library and register it as a provider:

```ts
export const ORDERS_GRPC = createToken<OrdersClient>('ORDERS_GRPC');

@Module({
  providers: [{ token: ORDERS_GRPC, useFactory: () => makeGrpcClient(env.ORDERS_ADDR) }],
})
export class GrpcModule {}
```

```ts
@Controller('/orders')
export class OrdersController {
  @Inject(ORDERS_GRPC) private readonly orders!: OrdersClient;

  @Get('/:id')
  async byId(ctx: Ctx<{ id: string }>) {
    return assert<Order>(await this.orders.get({ id: Number(ctx.params.id) }));
  }
}
```

This is a common and reasonable shape: zmdb serves HTTP at the edge and speaks gRPC to internal services. Behind a token, so tests substitute a fake with no network.

Validate what comes back. A generated gRPC stub's types describe the `.proto`, not what the server actually sent after a schema change.

## Serving gRPC alongside an HTTP app

Run the gRPC server yourself over the same container:

```ts
const app = createApp(AppModule);
await app.init();
const orders = app.container.resolve(ORDERS);

const server = new grpc.Server();
server.addService(ordersService, {
  get: async (call, callback) => {
    try {
      callback(null, await orders.findById(call.request.id));
    } catch (error) {
      callback({ code: grpc.status.INTERNAL, message: 'internal error' });
    }
  },
});
```

Note the error handling: return a status code, never the error message. A gRPC error message propagates to the caller, and a database error string discloses schema and topology.

Both surfaces share one container and one pool — see [Hybrid Applications](./web-hybrid-application.html) for the shutdown wiring, which you must write by hand.

## Security

- **TLS between services.** gRPC's `createInsecure()` is for local development only; on a shared network it is plaintext with credentials in metadata.
- **Authorise from the authenticated peer**, not from a field in the request message.
- **Set deadlines.** A gRPC call without one can hang indefinitely, and the server keeps working on a request nobody is waiting for.
- **Cap message sizes.** The default limits exist for a reason; raising them to accommodate a large payload is usually the wrong fix.

## What it would take

Protobuf support in `@zmdb/aot-validator` (a serialization backend alongside JSON), proto loading, `@GrpcMethod` metadata, a server adapter, and streaming — which needs the [response body change](./web-streaming-files.html).

The prerequisite decision is the schema-source question above. The version that fits the project would generate `.proto` _from_ the declared type rather than the reverse, keeping one source of truth — the `TypeIR` that `toJsonSchema` walks is the same input a `.proto` emitter needs. That is a substantial piece of work and has not been scheduled.

---

See also: [Microservice Transports](./web-microservices-transports.html) · [OpenAPI Operations](./web-openapi-operations.html) · [Hybrid Applications](./web-hybrid-application.html)
