> **ToDo / feature gap.** There is no protobuf encoder. See
> [Protobuf Messages](./protobuf-message.html) for the whole gap, why it is open,
> and what implementing it would involve.

## The nearest thing that exists

`stringify<T>()` is the generated serializer, and it is the function a protobuf encoder would sit alongside:

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

const bytes = new TextEncoder().encode(stringify<User>(user));
```

JSON, so larger on the wire than protobuf would be — but the encoder is generated from the type rather than reflecting over the value, which is where its speed comes from. For most service-to-service traffic, gzip over generated JSON is within a small factor of protobuf on size and competitive on time. Measure your payloads before assuming the format is the bottleneck. See [Benchmarks](./benchmarks.html).

## If you need bytes today

Use a protobuf library directly for the encode step and keep zmdb for the type:

```ts
import { assert } from '@zmdb/aot-validator/utilities';

export function encodeUser(value: unknown): Uint8Array {
  const user = assert<User>(value); // checked here
  return UserMessage.encode(toMessage(user)).finish();
}
```

The `assert` before the encode is the part worth keeping: `toMessage` is hand-written, so it is the place where the TypeScript type and the `.proto` can disagree, and validating the input means the failure names the field.

## What it would take

Generating the encoder is the mechanical half of [the protobuf work](./protobuf-message.html) — varint, zigzag and length-delimited framing over a descriptor walk the transformer already does for `stringify`. It is blocked on the type-mapping decisions (`int64`, field presence, `oneof`), not on the encoding itself.

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Decode](./protobuf-decode.html) · [stringify](./json-stringify.html)
