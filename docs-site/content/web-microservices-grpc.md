Typed gRPC services, exhaustive bindings and clients ship through `@zmdb/transport-grpc`. The declaration selects unary, client-streaming, server-streaming or bidirectional calls without loading a
`.proto` at runtime.

```bash
npm add @zmdb/protobuf@alpha @zmdb/transport-grpc@alpha @grpc/grpc-js@^1.14.0
npm add --save-dev @zmdb/aot-validator@alpha
```

Neither package nor grpc-js is installed by `npm add zmdb@alpha`. `@zmdb/protobuf` owns the service calls and generated artifact types; `@zmdb/aot-validator` owns reflection and emission;
`@zmdb/transport-grpc` owns the grpc-js binding. The application owns the server extension, while each client returned by `createGrpcClient` is caller-owned and must be closed.

## One TypeScript contract, including the wire format

gRPC uses the same type-derived protobuf path as `protoEncode`, `protoDecode` and `protoDescriptor`. Declare message field numbers in TypeScript and load the service at build time:

```ts
import { loadGrpcService } from '@zmdb/protobuf';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

interface GetOrder {
  readonly id: string & ProtoField<1>;
}

interface Order {
  readonly id: string & ProtoField<1>;
  readonly total: number & Proto<'int32'> & ProtoField<2>;
}

interface Chunk {
  readonly text: string & ProtoField<1>;
}

interface UploadAck {
  readonly received: number & Proto<'int32'> & ProtoField<1>;
}

type Orders = {
  readonly get: { readonly request: GetOrder; readonly response: Order };
  readonly upload: {
    readonly request: Chunk;
    readonly response: UploadAck;
    readonly requestStream: true;
  };
  readonly watch: {
    readonly request: GetOrder;
    readonly response: Order;
    readonly responseStream: true;
  };
  readonly chat: {
    readonly request: Chunk;
    readonly response: Chunk;
    readonly requestStream: true;
    readonly responseStream: true;
  };
};

export const ordersService = loadGrpcService<Orders>('Orders', 'orders');
```

`loadGrpcService` is declared by `@zmdb/protobuf` and compiled by the `@zmdb/aot-validator` build transform or `zmdb-codegen`. It becomes a frozen descriptor, method paths, streaming flags,
validators, and protobuf codecs. No `.proto` file is read or parsed at runtime, and `@grpc/proto-loader` is not a direct dependency.

That shape also makes the service closed: a binding with an unimplemented method does not compile. The streaming flags select the handler signature, so using a unary function where a server stream is
declared is a compile error.

Use `grpcDescriptor<Orders>('Orders', 'orders')` when another language needs the generated `.proto` contract. Commit that artifact and review its diff like any other wire-contract change.

## Bind all four call types

Import the runtime surface from its dedicated package:

```ts
import { bindGrpcService, type GrpcMetadata } from '@zmdb/transport-grpc';

function validateMetadata(metadata: GrpcMetadata): GrpcMetadata {
  if (metadata.headers.authorization === undefined) {
    throw new Error('missing authorization metadata');
  }
  return metadata;
}

const ordersBinding = bindGrpcService(
  {
    definition: ordersService,
    validateMetadata,
    onError: failure => errors.report(failure),
    maxDurationMs: 30_000,
  },
  {
    get: async call => orders.findById(call.payload.id),

    upload: async call => {
      let received = 0;
      for await (const chunk of call.payload) received += chunk.text.length;
      return { received };
    },

    watch: async function* (call) {
      for await (const order of orders.watch(call.payload.id, call.signal)) {
        yield order;
      }
    },

    chat: async function* (call) {
      let count = 0;
      for await (const chunk of call.payload) {
        count += 1;
        yield chunk;
      }
      call.setTrailer('x-message-count', String(count));
    },
  },
);
```

The service is a type alias and the handler object is a mapped type over every method. Omitting a method, using a unary handler for a streaming method, or passing the wrong request type is a compile
error. There is no `@GrpcMethod` decorator because a decorator cannot make a closed service exhaustive.

The four declaration shapes select four distinct APIs:

| Flags                  | Handler payload          | Handler result            |
| ---------------------- | ------------------------ | ------------------------- |
| neither                | one request              | `Promise<Response>`       |
| `requestStream: true`  | `AsyncIterable<Request>` | `Promise<Response>`       |
| `responseStream: true` | one request              | `AsyncIterable<Response>` |
| both                   | `AsyncIterable<Request>` | `AsyncIterable<Response>` |

## Application lifecycle

Attach the gRPC server as an explicit application extension. Extensions start in declaration order and stop in reverse order, so a failed bind rolls back extensions that already opened and disposal
closes gRPC before earlier transport extensions and application shutdown hooks:

```ts
import { grpcExtension } from '@zmdb/transport-grpc';

await using app = createApp(AppModule, {
  extensions: [
    grpcExtension({
      address: '0.0.0.0:50051',
      bindings: [ordersBinding],
      credentials: 'insecure',
    }),
  ],
  graceMs: 5_000,
});

await app.init();
```

Credentials are required and have no implicit insecure default. For TLS, pass server root certificates, key/certificate pairs and the client-certificate policy instead of `'insecure'`.

Graceful shutdown calls grpc-js `tryShutdown`; when `graceMs` expires it calls `forceShutdown`, so an abandoned bidirectional stream cannot stall a deploy indefinitely.

## Typed clients

The client uses the same generated artifact and therefore the same request, response and streaming declarations:

```ts
import { createGrpcClient } from '@zmdb/transport-grpc';

using client = createGrpcClient({
  definition: ordersService,
  address: 'orders.internal:50051',
  credentials: 'insecure',
  deadlineMs: 2_000,
  validateMetadata,
});

const order = await client.get(
  { id: 'o1' },
  {
    metadata: {
      headers: { authorization: `Bearer ${token}` },
      binaryHeaders: {},
    },
  },
);

for await (const update of client.watch({ id: 'o1' })) {
  consume(update);
}
```

Client-streaming and bidirectional methods accept an `AsyncIterable<Request>`. Server-streaming and bidirectional methods return an `AsyncIterable<Response>`. Every call accepts an optional deadline
override, `AbortSignal`, outbound metadata, and validated initial-metadata/trailer callbacks.

## Deadlines and cancellation

Every typed client call has a finite default deadline. The server exposes the effective budget through:

- `call.signal`, aborted when the caller cancels, its deadline expires, or the service `maxDurationMs` expires;
- `call.remainingMs()`, read at the moment it is called.

Propagate the remaining budget to nested work:

```ts
get: async call => {
  try {
    return await inventory.get(
      { id: call.payload.id },
      { deadlineMs: call.remainingMs(), signal: call.signal },
    );
  } finally {
    audit.finished(call.method);
  }
},
```

The service example above sets `maxDurationMs`, so the forwarded budget is finite even when an external caller omits a deadline. When the caller's deadline expires, the adapter aborts `call.signal`;
the nested operation is cancelled and the handler's `finally` runs.

An external client may omit a deadline. Such a call is served and `remainingMs()` returns `Number.POSITIVE_INFINITY` unless `maxDurationMs` provides a server-side bound.

The adapter makes request streams abort-aware and closes response generators when callers stop reading, so handler `finally` blocks run on both cancellation paths.

## Metadata and errors

Text metadata is exposed as `headers`. Binary `-bin` metadata is copied into a separate `binaryHeaders` map as `Uint8Array`; it is never base64 text in `headers`. `validateMetadata` runs before either
map reaches application code.

Use `call.setTrailer(key, value)` for facts learned after streaming starts. There is intentionally no `setHeader`, because response headers may already have been sent after the first yielded message.

Throw `GrpcError` only with details safe to disclose:

```ts
throw new GrpcError('NOT_FOUND', 'order not found');
```

Every other thrown value becomes `INTERNAL` with the fixed detail `internal error`; the real failure reaches the required `onError` sink. Malformed or invalid request frames return `INVALID_ARGUMENT`.

---

See also: [Microservice Transports](./web-microservices-transports.html) · [Protobuf Messages](./protobuf-message.html) · [Hybrid Applications](./web-hybrid-application.html)
