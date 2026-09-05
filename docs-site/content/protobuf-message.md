> **Supported.** `ProtoField<N>` and `Proto<K>` define a proto3 message contract. `protoDescriptor<T>()`, [`protoEncode<T>()`](./protobuf-encode.html) and [`protoDecode<T>()`](./protobuf-decode.html)
> are emitted at build time from the same checked TypeIR.

## Field numbers are the wire contract

```ts
import { protoDescriptor } from '@zmdb/protobuf';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

type State = 'active' | 'paused';

interface UserMessage {
  id: bigint & Proto<'uint64'> & ProtoField<1>;
  name: string & ProtoField<2>;
  state: State & ProtoField<3>;
  seenAt?: Date & ProtoField<4>;
}

export const userProto = protoDescriptor<UserMessage>();
```

Every property needs a unique `ProtoField<N>` in `1 … 536870911`, excluding the reserved `19000 … 19999` range. Missing, duplicate, out-of-range and reserved numbers are build diagnostics naming the
message and property.

The number, not the property name or declaration order, is the field's wire identity:

- Never renumber a released field or reuse the number of a removed field.
- Never change a field's scalar spelling or structural kind under an existing number. For example, `int32` to `sint32` changes how the same wire value is interpreted.
- Renaming a property while keeping its number and wire type is wire-compatible, although generated clients in another language will see a source-level rename.
- Add a field with a fresh number and make absence safe for every receiver in the rollout. Use an optional property when the application must distinguish absent from the protobuf zero value.

The build checks one declaration, not its history. It cannot detect that a number was used by an older release, and this surface does not emit `reserved` declarations for removed properties. Commit
the generated descriptor and review its diff; keep retired numbers unused.

## What the descriptor contains

The build transform replaces `protoDescriptor<T>()` with proto3 text. Fields are ordered by number, string unions become enums with a generated zero member, nested objects become messages, arrays
become `repeated`, optional or nullable singular fields become `optional`, and `Date` imports `google.protobuf.Timestamp`.

## Integer widths are explicit

An untagged `number` maps to `double`, the only protobuf scalar that can represent the full JavaScript `number` domain. Integer wire contracts need an explicit `Proto<K>`:

| TypeScript                 | Protobuf |
| -------------------------- | -------- |
| `number`                   | `double` |
| `number & Proto<'int32'>`  | `int32`  |
| `number & Proto<'sint32'>` | `sint32` |
| `bigint & Proto<'int64'>`  | `int64`  |
| `bigint & Proto<'uint64'>` | `uint64` |
| untagged `bigint`          | refused  |
| `number & Proto<'int64'>`  | refused  |

There is no silent integer default: choosing `int32` would truncate larger numbers, while choosing between signed, unsigned and zigzag encodings is part of the public wire contract. Every 64-bit
integer is a `bigint` on both encode and decode, even when its current value would fit in a `number`. SQL tags do not select protobuf widths.

## Presence and the zero-value surprise

Proto3 implicit presence makes a required scalar's zero value indistinguishable from absence:

```ts
import { protoDecode, protoEncode } from '@zmdb/protobuf';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

interface RequiredCount {
  count: number & Proto<'int32'> & ProtoField<1>;
}

protoEncode<RequiredCount>({ count: 0 }); // Uint8Array []
protoDecode<RequiredCount>(new Uint8Array()); // { count: 0 }

interface OptionalCount {
  count?: number & Proto<'int32'> & ProtoField<1>;
}

protoEncode<OptionalCount>({ count: 0 }); // Uint8Array [0x08, 0x00]
protoDecode<OptionalCount>(new Uint8Array()); // {}
```

A required nullable field uses the same explicit wire presence as an optional field: `null` is omitted, a present zero is written, and absence decodes to `null`. An optional nullable property is
refused because its three TypeScript states cannot round-trip through protobuf's two presence states.

## Unknown fields during a rolling deployment

The decoder skips unknown varint, fixed64, length-delimited and fixed32 fields, then discards their bytes. That lets an older consumer read the fields it knows from a message produced by a newer
sender.

It does not make an old intermediary transparent. If that service decodes and re-encodes the message, every field it did not know is gone before the next service receives it. During a mixed-version
rollout, forward the original bytes through relays or deploy so no old hop has to decode and re-encode a newer message.

## Interoperability evidence

The repository tests make narrower, measurable claims instead of declaring blanket compatibility:

- `interop.spec.ts` parses the emitted descriptor with protobufjs, decodes bytes protobufjs produced, and gives emitted bytes back to protobufjs.
- `protobuf.spec.ts` compares the scalar, packing, presence, nesting and timestamp cases with fixed vectors produced with protoc 34.2, including exact 64-bit extrema.

Those tests cover the supported mapping and fixtures. They do not claim support for the features refused below.

## Scope and alternatives

**Compact outbound wire format for internal service calls.** Use `protoEncode<T>(value)` for bytes compiled from the same declaration as the descriptor, and `protoDecode<T>(bytes)` for the matching
inbound TypeScript shape.

**A schema contract between services in different languages.** Emit `protoDescriptor<T>()` during the build and feed the resulting `.proto` text to the other language's ordinary protobuf generator.
OpenAPI and JSON Schema remain the alternatives for JSON APIs.

**gRPC.** Typed service descriptors, server binding and clients use these same message codecs — see [gRPC](./web-microservices-grpc.html).

**Another protobuf library.** Generate the `.proto` from the TypeScript declaration, then let that library compile or load the artifact:

```ts
import { writeFile } from 'node:fs/promises';

await writeFile('user.proto', protoDescriptor<UserMessage>());
```

The supported surface is proto3 message/service descriptors, AOT message codecs, and typed gRPC binding from the same declaration. Proto2 semantics and runtime `.proto` parsing remain non-goals. The
current mapping also refuses maps because index signatures do not reach the reflector, `oneof` because union arms have no field-number tag slot, `bytes` because typed-array reflection is absent,
nested arrays, optional-nullable fields, and required singular-message cycles.

---

See also: [stringify](./json-stringify.html) · [parse](./json-parse.html) · [gRPC](./web-microservices-grpc.html)
