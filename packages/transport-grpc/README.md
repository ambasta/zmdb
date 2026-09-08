# @zmdb/transport-grpc

`@zmdb/transport-grpc` binds generated `@zmdb/protobuf` service artifacts to real grpc-js servers and typed clients. It owns deadlines, cancellation, metadata validation, streaming and bounded
application shutdown without parsing `.proto` files at runtime.

## Install

```bash
npm add @zmdb/app@1.0.0-beta.1 @zmdb/protobuf@1.0.0-beta.1 @zmdb/transport-grpc@1.0.0-beta.1 @grpc/grpc-js@^1.14.4
npm add @zmdb/validator@1.0.0-beta.1
npm add --save-dev @zmdb/compiler@1.0.0-beta.1
```

> **Prerelease** (`1.0.0-beta.1`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

The sole peer is `@grpc/grpc-js@^1.14.4`. The package is not installed by `npm add zmdb@1.0.0-beta.1`; `@zmdb/protobuf` supplies the source-level service artifact, `@zmdb/compiler` emits it at build
time, and the generated validators import the `@zmdb/validator` runtime ABI.

## Usage

```ts
import { Module, createApplication } from '@zmdb/app';
import { loadGrpcService } from '@zmdb/protobuf';
import { type ProtoField } from '@zmdb/schema/tags';
import { bindGrpcService, grpcExtension, type GrpcMetadata } from '@zmdb/transport-grpc';

interface GetOrder {
  readonly id: string & ProtoField<1>;
}

interface Order {
  readonly id: string & ProtoField<1>;
}

type Orders = {
  readonly get: { readonly request: GetOrder; readonly response: Order };
};

const ordersService = loadGrpcService<Orders>('Orders', 'orders');

const orders = bindGrpcService(
  {
    definition: ordersService,
    validateMetadata: (metadata: GrpcMetadata) => metadata,
    onError: failure => console.error(failure.error),
  },
  {
    get: async call => ({ id: call.payload.id }),
  },
);

@Module({})
class AppModule {}

await using app = createApplication(AppModule, {
  extensions: [
    grpcExtension({
      address: '0.0.0.0:50051',
      bindings: [orders],
      credentials: 'insecure',
    }),
  ],
});

await app.init();
```

The caller owns every client returned by `createGrpcClient` and closes it with `close()` or `Symbol.dispose`. The application owns the server extension and applies its configured grace budget during
shutdown. The extension owns its grpc-js server; it attempts graceful shutdown, then forces closure when the grace budget expires.

## Entry points

- `@zmdb/transport-grpc` — server bindings, `grpcExtension`, typed clients, status errors and application-facing gRPC types.

## Documentation

Typed gRPC guide: **https://ambasta.github.io/zmdb/docs/web-microservices-grpc.html**

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
