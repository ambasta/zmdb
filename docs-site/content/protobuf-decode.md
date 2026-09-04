> **AOT decoder available.** `protoDecode<T>(bytes)` is replaced at build time
> with a field-number-dispatched protobuf decoder over a bounded byte reader.
> The final cross-page protobuf documentation pass remains tracked separately.

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

## Presence and values

- Absent required scalars become `0`, `0n`, `false` or `''`.
- Absent optional properties are omitted; required-nullable properties become
  `null`; repeated fields become `[]`.
- Every 64-bit integer decodes to `bigint`.
- `google.protobuf.Timestamp` decodes to `Date`; that declared type cannot
  retain sub-millisecond precision.
- Enum zero and unknown enum numbers are errors naming the field.

Proto3 implicit presence means an empty message can decode to a plausible
all-zero object. Use an optional property when presence itself matters.

## Malformed and forward-version input

Varints, fixed-width values and length-delimited payloads are checked against
the remaining input before they are read. A malicious length cannot trigger an
allocation proportional to its claim. Truncation reports the byte offset,
invalid UTF-8 is refused, and deprecated group wire types are rejected.

Unknown varint, fixed64, length-delimited and fixed32 fields are skipped and
discarded. Decode-then-re-encode therefore drops fields added by a newer sender;
forward the original bytes when unknown-field preservation is required.

## Deliberate refusals

The decoder shares the descriptor and encoder's refusals: maps remain blocked
by index-signature reflection, nested arrays have no direct proto3 spelling,
optional-nullable fields have three source states but two wire states, oneof
arms have no field-number tag slot, and typed-array reflection cannot yet carry
`bytes`.

A cycle made entirely of required singular message fields is also refused. A
wire message may omit every singular message field, but that TypeScript shape
has no finite value to return; make one edge optional, nullable or repeated.

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Encode](./protobuf-encode.html) · [AOT Setup](./aot-setup.html)
