# @zmdb/protobuf

`@zmdb/protobuf` provides the source calls, typed gRPC service artifacts, and zero-dependency wire runtime used by zmdb's ahead-of-time protobuf compiler.

Reflection, descriptor emission, and codec generation remain build-time responsibilities of `@zmdb/aot-validator`; this package contains no schema parser or TypeScript compiler.

## Install

```bash
npm add @zmdb/protobuf@alpha
npm add --save-dev @zmdb/aot-validator@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- `@zmdb/protobuf` — `protoEncode`, `protoDecode`, `protoDescriptor`, `grpcDescriptor`, `loadGrpcService`, and the typed service-artifact contracts.
- `@zmdb/protobuf/wire` — `ProtoReader` and `ProtoWriter`, the generated-code ABI.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
