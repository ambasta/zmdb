# @zmdb/protobuf

`@zmdb/protobuf` provides the source calls, typed gRPC service artifacts, and zero-dependency wire runtime used by zmdb's ahead-of-time protobuf compiler.

Reflection, descriptor emission, and codec generation are build-time responsibilities of `@zmdb/compiler`; this package contains no schema parser or TypeScript compiler.

## Install

```bash
yarn add @zmdb/protobuf@1.0.0-beta.2
yarn add --dev @zmdb/compiler@1.0.0-beta.2 typescript@^7
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

`@zmdb/protobuf` has no runtime dependency or peer dependency and is not installed by `@zmdb/core`. Its development dependency is `@zmdb/compiler`, the build-time reflector/emitter; generated code
imports the wire runtime from this package.

## Usage

```ts
import { protoDescriptor, protoEncode } from '@zmdb/protobuf';
import { type Proto, type ProtoField } from '@zmdb/schema/tags';

interface OrderMessage {
  readonly id: string & ProtoField<1>;
  readonly total: number & Proto<'int32'> & ProtoField<2>;
}

const descriptor = protoDescriptor<OrderMessage>();
const bytes = protoEncode<OrderMessage>({ id: 'o1', total: 42 });

void [descriptor, bytes];
```

The source calls above must pass through the `@zmdb/compiler` build transform or project compiler. The package owns no compiler process, file watcher, connection, or shutdown hook.

## Entry points

- `@zmdb/protobuf` — `protoEncode`, `protoDecode`, `protoDescriptor`, `grpcDescriptor`, `loadGrpcService`, and the typed service-artifact contracts.
- `@zmdb/protobuf/wire` — `ProtoReader` and `ProtoWriter`, the generated-code ABI.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

Mozilla Public License 2.0 (MPL-2.0) — see [LICENSE](./LICENSE).
