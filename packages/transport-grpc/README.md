# @zmdb/transport-grpc

`@zmdb/transport-grpc` binds generated `@zmdb/protobuf` service artifacts to real grpc-js servers and typed clients. It owns deadlines, cancellation, metadata validation, streaming and bounded
application shutdown without parsing `.proto` files at runtime.

## Install

```bash
npm add @zmdb/transport-grpc@alpha @grpc/grpc-js
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Usage

```ts
import { createApplication } from '@zmdb/app';
import { bindGrpcService, grpcExtension } from '@zmdb/transport-grpc';

const orders = bindGrpcService(
  {
    definition: ordersService,
    validateMetadata,
    onError: failure => errors.report(failure),
  },
  handlers,
);

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
shutdown.

## Entry points

- `@zmdb/transport-grpc` — server bindings, `grpcExtension`, typed clients, status errors and application-facing gRPC types.

## Documentation

Typed gRPC guide: **https://ambasta.github.io/zmdb/docs/web-microservices-grpc.html**

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
