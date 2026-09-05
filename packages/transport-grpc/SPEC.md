# `@zmdb/transport-grpc` — gRPC server and typed-client integration

> Frozen by #654 for epic #653 and implemented by #657. The detailed call, deadline, metadata, error and lifecycle contract lives in [`src/SPEC.md`](./src/SPEC.md).

## 1. Package boundary

The package adapts generated `@zmdb/protobuf` service artifacts to `@grpc/grpc-js` and the `@zmdb/app` extension lifecycle. It owns no reflection, emitter or runtime `.proto` parser.

Manifest edges are exact:

| Kind          | Package          | Range         |
| ------------- | ---------------- | ------------- |
| dependency    | `@zmdb/app`      | `workspace:^` |
| dependency    | `@zmdb/protobuf` | `workspace:^` |
| required peer | `@grpc/grpc-js`  | `^1.14.0`     |
| dev evidence  | `@grpc/grpc-js`  | `1.14.4`      |

`@grpc/proto-loader` is absent. The package root is side-effect-free and is its only export.

## 2. Public API

```ts
export function grpcExtension(options: GrpcServerOptions): ApplicationExtension;
export function bindGrpcService<S extends GrpcServiceDef>(service: GrpcServiceSpec<S>, handlers: GrpcHandlers<S>): GrpcBinding;
export function createGrpcClient<S extends GrpcServiceDef>(options: GrpcClientOptions<S>): GrpcClient<S>;
export class GrpcError extends Error {
  readonly status: GrpcStatus;
  readonly details: string;
}
```

The root also exports the current application-facing types unchanged: `GrpcBinding`, `GrpcCall`, `GrpcCaller`, `GrpcClient`, `GrpcClientCallOptions`, `GrpcClientOptions`, `GrpcClientTlsOptions`,
`GrpcFailure`, `GrpcHandler`, `GrpcHandlers`, `GrpcKeyCertPair`, `GrpcMetadata`, `GrpcMetadataValidator`, `GrpcServerOptions`, `GrpcServerTlsOptions`, `GrpcServiceSpec`, `GrpcStatus` and
`GrpcTlsOptions`.

Their exact shapes and the four streaming combinations remain normative in [`src/SPEC.md`](./src/SPEC.md). The service artifact calls and `GrpcLoaded*`/`Grpc*Def` types are **not** re-exported: their
single owner is `@zmdb/protobuf`.

## 3. Lifecycle and ownership

- `bindGrpcService` is pure construction and performs no bind or network I/O.
- `grpcExtension` opens one grpc-js server during application start, registers every supplied binding, and closes that server through the application grace-bound shutdown path.
- A failed bind rejects startup and rolls back extensions already opened according to `@zmdb/app`; no module-scope server survives.
- `createGrpcClient` owns one grpc-js channel per returned client. The caller closes it through `close()` or `[Symbol.dispose]()`.
- TLS material, metadata validators and error sinks are caller supplied. The package does not discover credentials, install interceptors globally or retry calls.

The server preserves deadlines, cancellation, metadata validation, trailers, safe status mapping and the current all-four-call-shapes behavior. Public binary values remain `Uint8Array`; conversion to
grpc-js `Buffer` occurs only at the private peer boundary.

## 4. Migration

`@zmdb/web/microservices/grpc` is removed with no forwarding export. Direct `grpc` application options become an explicit extension:

```ts
createApplication(root, {
  extensions: [grpcExtension(serverOptions)],
});
```

Source imports generated service artifacts from `@zmdb/protobuf` and imports server/client adapters from this package. Core `@zmdb/app`, `@zmdb/web`, `@zmdb/jobs` and `zmdb` do not import or re-export
this package.

Installation is:

```sh
yarn add @zmdb/transport-grpc @grpc/grpc-js
```

## 5. Required evidence

1. The current real in-process grpc-js suite retains all four call shapes, deadlines, cancellation, metadata, validation, status mapping and bounded shutdown.
2. A package-boundary type suite proves exhaustive handlers, stream-shape selection, required credentials and disposable clients against packed declarations.
3. A packed external app installs only the package, its peer and declared internal dependencies, starts an extension, makes a typed call and shuts down.
4. Importing the package performs no bind, creates no client/server and loads no proto parser.
5. Static dependency checks prove that grpc-js is declared by this package alone and that neither core nor `@zmdb/protobuf` reaches it.
