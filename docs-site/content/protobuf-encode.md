> **Supported.** `protoEncode<T>(value)` is replaced at build time with a straight-line proto3 message encoder. The matching [`protoDecode<T>()`](./protobuf-decode.html) is emitted from the same
> checked TypeIR.

## Encode a tagged message

Give every property a stable field number and select an integer width whenever the field is not a protobuf `double`:

```ts
import { protoEncode } from '@zmdb/protobuf';
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

The transform compiles the type to direct property reads in field-number order. The emitted application imports only the growable wire writer; it does not walk a descriptor or look a field up by name.
The returned `Uint8Array` owns an exact-sized buffer.

An untransformed call throws. A type argument has no runtime representation, so there is no safe fallback that can recover the field numbers.

## Integer widths are part of the contract

An untagged `number` is a protobuf `double`. To put an integer on the wire, choose its width and signedness explicitly with `Proto<'int32'>`, `Proto<'uint32'>`, `Proto<'sint32'>`, or a fixed-width
spelling. There is no silent `int32` default because values above its range would be truncated without a type error.

Every 64-bit integer uses `bigint` plus an explicit 64-bit tag:

```ts
interface Counters {
  signed: bigint & Proto<'int64'> & ProtoField<1>;
  compactNegative: bigint & Proto<'sint64'> & ProtoField<2>;
  unsigned: bigint & Proto<'uint64'> & ProtoField<3>;
}
```

An untagged `bigint` is refused because signedness is unknown. A `number` tagged as a 64-bit integer is refused because it cannot represent the full promised range.

## Presence and field order

A required scalar zero is omitted under proto3 implicit presence. An optional zero is written because the property being present is itself information:

```ts
interface RequiredCount {
  count: number & Proto<'int32'> & ProtoField<1>;
}

interface OptionalCount {
  count?: number & Proto<'int32'> & ProtoField<1>;
}

protoEncode<RequiredCount>({ count: 0 }); // Uint8Array []
protoEncode<OptionalCount>({ count: 0 }); // Uint8Array [0x08, 0x00]
```

Fields are emitted in field-number order, not declaration order. Reordering properties therefore does not change the bytes; changing a released `ProtoField<N>` does.

## Wire mapping

- Untagged `number` is `double`; explicit 32-bit integer and float tags are honoured.
- Every 64-bit integer is a `bigint` with an explicit 64-bit `Proto<K>` tag and never passes through `Number`.
- Required scalar zero values are omitted. Optional and required-nullable fields write an explicitly present zero.
- Numeric, boolean and enum arrays are packed. Strings and nested messages are emitted as separate length-delimited occurrences.
- Nested messages use varint length prefixes, including payloads above 127 bytes. `Date` maps to `google.protobuf.Timestamp`.
- String unions encode as enum numbers starting at 1; zero stays the generated unspecified value used by the descriptor.

`ProtoField<N>` values must be unique within their message, in `1 … 536870911` excluding `19000 … 19999`. Invalid or missing field numbers and unsupported scalar choices are build diagnostics.

## Interoperability evidence

The test named `produces bytes a reference implementation decodes` passes the emitted interop message to protobufjs. Separate fixed vectors produced with protoc 34.2 cover the scalar matrix, packing,
proto3 presence, nesting, timestamps and full-width 64-bit extrema. That is evidence for those fixtures, not a claim about unsupported protobuf features.

## Limits

Some shapes are refused rather than guessed: nested arrays have no direct proto3 spelling, optional-nullable fields have three source states but two wire states, discriminated unions have no
field-number slot for `oneof`, and maps remain blocked because the reflector cannot model index signatures. `Proto<'bytes'>` is also refused until typed-array reflection can carry `Uint8Array`.

`protoDecode<T>()` supplies the matching inbound path. It accepts alternate valid field orders and packed/unpacked repeated forms, bounds malformed lengths, and discards unknown fields.
Decode-then-re-encode is therefore not suitable for a proxy or relay. The numbering and rollout rules are on [Protobuf Messages](./protobuf-message.html).

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Decode](./protobuf-decode.html) · [AOT Setup](./aot-setup.html)
