# `@zmdb/protobuf` — generated protobuf runtime contract

> Frozen by #654 for epic #653 and implemented by #656. The package now owns the public calls, artifact types, and wire ABI while `@zmdb/aot-validator` retains the single compiler front end.

## 1. Ownership

`@zmdb/protobuf` owns the source-level protobuf calls, gRPC service-artifact types and the byte-level runtime used by generated codecs. It does **not** own reflection or emission:

- `@zmdb/aot-validator` remains the only TypeScript checker client, `TypeIR`/service-IR walker and JavaScript emitter;
- `.proto` is generated output, never runtime input;
- the runtime receives no descriptor, schema object, checker or metadata reader; and
- `protobufjs` and `protoc` remain test or external interoperability oracles, never runtime dependencies.

The package has no runtime dependency and no peer dependency. Installing it does not install TypeScript or a protobuf implementation.

## 2. Public exports

The root export is exact:

```ts
export function protoEncode<T>(value: T): Uint8Array;
export function protoDecode<T>(bytes: Uint8Array): T;
export function protoDescriptor<T>(): string;

export interface GrpcMethodDef {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
}

export type GrpcServiceDef = {
  readonly [method: string]: GrpcMethodDef;
};

export interface GrpcLoadedMethod<D extends GrpcMethodDef> {
  readonly path: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
  validateRequest(value: unknown): D['request'];
  serializeRequest(value: D['request']): Uint8Array;
  deserializeRequest(bytes: Uint8Array): D['request'];
  validateResponse(value: unknown): D['response'];
  serializeResponse(value: D['response']): Uint8Array;
  deserializeResponse(bytes: Uint8Array): D['response'];
}

export interface GrpcLoadedService<S extends GrpcServiceDef> {
  readonly name: string;
  readonly descriptor: string;
  readonly methods: { readonly [M in keyof S]: GrpcLoadedMethod<S[M]> };
}

export function grpcDescriptor<S extends GrpcServiceDef>(service: string, packageName: string): string;
export function loadGrpcService<S extends GrpcServiceDef>(service: string, packageName: string): GrpcLoadedService<S>;
```

There is one generated-code ABI subpath:

```ts
// @zmdb/protobuf/wire
export class ProtoReader {}
export class ProtoWriter {}
```

`ProtoReader` and `ProtoWriter` remain public only because emitted JavaScript imports them by package name. They are not a descriptor API and are not re-exported from the package root.

## 3. Compiler handshake

Application source imports all five transformed calls from `@zmdb/protobuf`. Call recognition is binding-based:

- a direct or aliased binding that resolves to a named root export is recognised;
- a namespace property may be recognised only when its symbol resolves to the same export;
- a local function, shadowed binding or same-named export from another module is ignored; and
- re-exporting these calls through `zmdb`, `@zmdb/aot-validator` or another package is not a supported compiler entry.

The untransformed functions throw by name because an erased type argument cannot be reconstructed at runtime. No slow parser fallback is permitted.

Generated artifacts use canonical imports:

| Artifact                                   | Import                                                 |
| ------------------------------------------ | ------------------------------------------------------ |
| encoder/decoder JavaScript                 | `ProtoReader`/`ProtoWriter` from `@zmdb/protobuf/wire` |
| gRPC witness and declaration artifacts     | service calls and artifact types from `@zmdb/protobuf` |
| reflection, diagnostics and source rewrite | remain inside `@zmdb/aot-validator`                    |

Generated code must not import `@zmdb/aot-validator/protobuf/wire`, and protobuf declarations must not import their public artifact types from `@zmdb/aot-validator`.

## 4. Lifecycle and compatibility

The package owns no connection, server, process or global registry. Calls compile to local straight-line helpers; importing either entry point performs no I/O and changes no global state.

Wire behavior, refusals and interoperability remain the contract in `../aot-validator/src/emit/SPEC.md` §7b. Moving ownership does not change field numbering, scalar widths, presence, enum-zero,
unknown-field or gRPC service-artifact semantics.

## 5. Migration and installation

The implementation removes, rather than forwards:

- the three protobuf calls and the two gRPC artifact calls/types from `@zmdb/aot-validator`; and
- `@zmdb/aot-validator/protobuf/wire`.

Standalone installation is:

```sh
yarn add @zmdb/protobuf
yarn add --dev @zmdb/aot-validator
```

The second line supplies the build-time compiler. A project that already receives the compiler through its zmdb toolchain does not add it twice.

## 6. Required evidence

Before publication:

1. `protobufjs` parses the emitted descriptor and decodes emitted bytes, while the emitted decoder accepts the fixed `protoc` vector already frozen by `interop.spec.ts`.
2. Plugin and codegen routes produce equivalent artifacts whose imports match §3.
3. Local shadowing and same-named foreign calls remain byte-identical; direct and aliased package imports transform.
4. A packed external project installs `@zmdb/protobuf`, runs codegen, imports both published entry points and typechecks without workspace mappings.
5. Its packed manifest has no runtime or peer dependency and no runtime path reaches TypeScript, a reflector, `protobufjs` or `@grpc/proto-loader`.
