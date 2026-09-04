> **Supported.** `protoDecode<T>(bytes)` is replaced at build time with a
> field-number-dispatched proto3 message decoder over a bounded byte reader.

## Decode a tagged message

```ts
import { protoDecode } from '@zmdb/aot-validator';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

interface UserMessage {
  id: number & Proto<'int32'> & ProtoField<1>;
  name: string & ProtoField<2>;
  deltas: (number & Proto<'sint32'>)[] & ProtoField<3>;
  marker?: number & Proto<'int32'> & ProtoField<4>;
}

const user = protoDecode<UserMessage>(bytes);
```

The transform emits one switch over field numbers. It accepts fields in any
order, takes the last singular scalar, concatenates repeated occurrences, and
accepts packed or unpacked forms for repeated numeric, boolean and enum fields.
It does not walk a descriptor at runtime. An untransformed call throws because
type arguments and phantom field tags do not exist at runtime.

## Presence and the zero-value case

- Absent required scalars become `0`, `0n`, `false` or `''`.
- Absent optional properties are omitted; required-nullable properties become
  `null`; repeated fields become `[]`.
- Every 64-bit integer decodes to `bigint`.
- `google.protobuf.Timestamp` decodes to `Date`; that declared type cannot
  retain sub-millisecond precision.
- Enum zero and unknown enum numbers are errors naming the field.

Proto3 implicit presence means an empty message can decode to a plausible
all-zero object:

```ts
interface RequiredCount {
  count: number & Proto<'int32'> & ProtoField<1>;
}

interface OptionalCount {
  count?: number & Proto<'int32'> & ProtoField<1>;
}

protoDecode<RequiredCount>(new Uint8Array()); // { count: 0 }
protoDecode<OptionalCount>(new Uint8Array()); // {}
```

Use an optional property when presence itself matters. Decoding establishes the
supported protobuf shape; it does not apply unrelated validation tags or domain
rules. Compose an emitted `assert<T>` around the decoded value when those checks
are part of the boundary.

## Malformed input

Varints, fixed-width values and length-delimited payloads are checked against
the remaining input before they are read. A malicious length cannot trigger an
allocation proportional to its claim. Truncation reports the byte offset,
invalid UTF-8 is refused, and deprecated group wire types are rejected.

Known scalar fields presented with an incompatible wire type are skipped. A
singular scalar that appears more than once takes its last compatible value;
repeated occurrences are concatenated.

## Unknown fields during a rolling deployment

Unknown varint, fixed64, length-delimited and fixed32 fields are skipped and
discarded.

That distinction matters during a rolling deployment. An old consumer can read
the fields it knows from a newer sender, but an old intermediary that decodes and
re-encodes the message strips every newer field before forwarding it. Forward
the original bytes when unknown-field preservation is required.

## Interoperability evidence

The test named `decodes bytes produced by a reference implementation` feeds
protobufjs output to the emitted decoder. Fixed protoc 34.2 vectors separately
cover every supported scalar, packed fields, nesting, presence and timestamps.
The malformed-input tests exercise every truncation of a valid length-delimited
message and reject oversized lengths before allocation.

## Deliberate refusals

The decoder shares the descriptor and encoder's refusals: maps remain blocked
by index-signature reflection, nested arrays have no direct proto3 spelling,
optional-nullable fields have three source states but two wire states, `oneof`
arms have no field-number tag slot, and typed-array reflection cannot yet carry
`bytes`.

A cycle made entirely of required singular message fields is also refused. A
wire message may omit every singular message field, but that TypeScript shape
has no finite value to return; make one edge optional, nullable or repeated.

Proto2 semantics, gRPC service definitions and runtime `.proto` parsing are
outside this message decoder. See [Protobuf Messages](./protobuf-message.html)
for the complete scope and wire-compatibility rules.

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Encode](./protobuf-encode.html) · [AOT Setup](./aot-setup.html)
