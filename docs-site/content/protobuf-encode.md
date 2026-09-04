> **AOT encoder available.** `protoEncode<T>(value)` is replaced at build time
> with a straight-line protobuf encoder. The matching decoder remains open; see
> [Protobuf Decode](./protobuf-decode.html) for the inbound workaround.

## Encode a tagged message

Give every property a stable field number and opt into integer widths where a
TypeScript `number` is not enough to choose the wire type:

```ts
import { protoEncode } from '@zmdb/aot-validator';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

interface UserMessage {
  id: number & Proto<'int32'> & ProtoField<1>;
  name: string & ProtoField<2>;
  deltas: (number & Proto<'sint32'>)[] & ProtoField<3>;
  marker?: number & Proto<'int32'> & ProtoField<4>;
}

const bytes = protoEncode<UserMessage>({
  id: 150,
  name: 'Ada',
  deltas: [-1, 0, 1],
  marker: 0,
});
```

The transform compiles the type to direct property reads in field-number order.
The emitted application imports only the growable wire writer; it does not walk
a descriptor or look a field up by name. The returned `Uint8Array` owns an
exact-sized buffer.

An untransformed call throws. A type argument has no runtime representation, so
there is no honest fallback that can recover the field numbers.

## Frozen wire mapping

- Untagged `number` is `double`; explicit 32-bit integer and float tags are
  honoured.
- Every 64-bit integer is a `bigint` with an explicit 64-bit `Proto<K>` tag and
  never passes through `Number`.
- Required scalar zero values are omitted. Optional and required-nullable
  fields write an explicitly present zero.
- Numeric, boolean and enum arrays are packed. Strings and nested messages are
  emitted as separate length-delimited occurrences.
- Nested messages use varint length prefixes, including payloads above 127
  bytes. `Date` maps to `google.protobuf.Timestamp`.
- String unions encode as enum numbers starting at 1; zero stays the generated
  unspecified value used by the descriptor.

`ProtoField<N>` values must be unique within their message, in `1 … 536870911`
excluding `19000 … 19999`. Invalid or missing field numbers and unsupported
scalar choices are build diagnostics.

## Interoperability and limits

The frozen vectors are checked against protobufjs and protoc 34.2. The encoder
produces bytes the reference implementation decodes, including packed fields,
proto3 presence and full-width 64-bit extrema.

Some shapes are refused rather than guessed: nested arrays have no direct
proto3 spelling, optional-nullable fields have three source states but two wire
states, discriminated unions have no field-number slot for `oneof`, and maps
remain blocked because the reflector cannot model index signatures.
`Proto<'bytes'>` is also refused until typed-array reflection can carry
`Uint8Array`.

There is not yet a zmdb `protoDecode<T>()`. For a round trip today, decode with
your protobuf implementation and adapt its result to the declared TypeScript
shape. Unknown-field handling and malformed-input bounds belong to the decoder
slice, not this outbound encoder.

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Decode](./protobuf-decode.html) · [AOT Setup](./aot-setup.html)
