> **ToDo / feature gap.** There is no gRPC support — no service binding, no
> streaming call types, no client factory.
>
> The shape it will ship as is frozen in
> `packages/web/src/microservices/grpc/SPEC.md`, and the schema-source question
> below is settled rather than open.

## Why this is a larger gap than the other transports

gRPC is not just a transport. It brings a schema language (`.proto`), a code generator, HTTP/2 streaming and a wire format — and each of those overlaps something zmdb already does differently:

| gRPC                          | zmdb equivalent                                                        |
| ----------------------------- | ---------------------------------------------------------------------- |
| `.proto` as the schema source | a TypeScript type with `ProtoField<N>` tags — and `.proto` is _output_ |
| `protoc` code generation      | [derived DTOs](./type-derivation.html), no generation step             |
| protobuf wire format          | `protoEncode`/`protoDecode`, emitted from the shared checked TypeIR    |
| Streaming RPC                 | an `async function*`, the same shape a GraphQL subscription uses       |

The first row is the one that used to be a tension and is now a decision: `.proto` is generated **from** the declared type, so there is one source of truth and the `.proto` is an artifact you commit and diff in CI. That resolves the conflict with the project's [type-derived design](./anti-patterns.html) rather than living with it.

Two claims that used to be on this page are no longer true. Protobuf message support now ships — `protoEncode`, `protoDecode` and `protoDescriptor` are emitted from the contract in `packages/aot-validator/src/emit/SPEC.md` §7b, with the `ProtoField<N>` and `Proto<K>` vocabulary in `packages/schema-core/src/ir/SPEC.md` §4.5. And streaming RPC was never blocked by the HTTP pipeline's former [string response body](./web-streaming-files.html): a gRPC stream never touches `WebResponse`. What remains is the gRPC-owned service descriptor and binding.

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

Note the error handling: return a status code, never the error message. A gRPC error message propagates to the caller, and a database error string discloses schema and topology. The freeze makes this the default rather than the advice — anything other than a deliberately-thrown `GrpcError` becomes `INTERNAL` with a fixed string, and the real error goes to a required `onError` sink.

Both surfaces share one container and one pool — see [Hybrid Applications](./web-hybrid-application.html) for the shutdown wiring, which you must write by hand.

## Security

- **TLS between services.** gRPC's `createInsecure()` is for local development only; on a shared network it is plaintext with credentials in metadata.
- **Authorise from the authenticated peer**, not from a field in the request message.
- **Set deadlines.** A gRPC call without one can hang indefinitely, and the server keeps working on a request nobody is waiting for.
- **Cap message sizes.** The default limits exist for a reason; raising them to accommodate a large payload is usually the wrong fix.

## What it would take

The schema-source question is answered: `.proto` is generated from the declared type, and the `TypeIR` that `toJsonSchema` walks is the input the emitter uses. The protobuf message codecs now ship. What remains is a `service`-block emitter beside them and the binding.

The binding has no decorator. A service is a `type` alias and the handlers are a mapped type over it:

```ts
type Orders = {
  readonly get: { request: GetOrder; response: Order };
  readonly watch: { request: WatchOrders; response: Order; responseStream: true };
};

const binding = bindGrpcService<Orders>(spec, {
  get: async call => orders.findById(call.payload.id),
  watch: async function* (call) {
    for await (const row of orders.stream(call.payload, call.signal)) yield row;
  },
});
```

That shape is chosen for one property a decorator cannot have: **a service with an unimplemented method does not compile.** A gRPC service is a closed contract shared with another language, so an omission has to be a type error at the handler rather than an `UNIMPLEMENTED` status at the caller. It also means one binding covers all four call types — the streaming flags in the declaration decide the handler's signature, so a unary function where a server stream is declared is a compile error too. Nest needs `@GrpcMethod` and `@GrpcStreamMethod` because it loaded its `.proto` into an untyped object; generating the descriptor from the types means the flags are known statically.

Nothing parses a `.proto`, at build time or runtime. `@grpc/proto-loader` would be startup I/O, a second implementation of the protobuf grammar whose disagreements with our emitter are wire bugs, and an untyped result needing a cast per message. Consuming somebody else's `.proto` is a real need and is a separate code generator emitting a `.d.ts` — the same one-source-of-truth answer run the other way, with no runtime surface.

Two more decisions worth knowing before you plan around this. `credentials` is a required option with no default, because `createInsecure()` as a default is how plaintext reaches production. And a deadline is exposed as both an `AbortSignal` and a `remainingMs()`, because an outbound call inside a handler must inherit the remaining budget — otherwise three services with a 5-second deadline each take 15 seconds while the original caller left after 5, and all three log a success.

The protobuf message dependency is now satisfied. The remaining gRPC work is the service-block descriptor, the `ServiceDefinition` adapter and the server/client binding.

---

See also: [Microservice Transports](./web-microservices-transports.html) · [OpenAPI Operations](./web-openapi-operations.html) · [Hybrid Applications](./web-hybrid-application.html)
