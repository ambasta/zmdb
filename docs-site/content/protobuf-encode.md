> **ToDo / feature gap.** There is no protobuf encoder. See
> [Protobuf Messages](./protobuf-message.html) for the descriptor surface that
> exists and the remaining codec gap.

## The nearest thing that exists

`stringify()` is the current JSON-compatible serializer, and it is the function
a protobuf encoder would sit alongside:

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

const bytes = new TextEncoder().encode(stringify<User>(user));
```

This is JSON, so it is larger on the wire than protobuf for many numeric-heavy
payloads. At this revision `stringify` uses the runtime `JSON.stringify`-compatible
fallback; the protobuf design is the binary AOT target. Measure your payloads
before assuming the format is the bottleneck. See [Benchmarks](./benchmarks.html).

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

The type mapping is frozen: explicit integer widths, proto3 presence, packed
scalar arrays, nested messages, enums, `Date`/Timestamp, and the refused shapes
are all specified. The field-number/scalar IR and descriptor prerequisite now
ships; the remaining work is the emitted encoder itself. `oneof` is refused
rather than pending, and maps remain blocked by reflection.

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Decode](./protobuf-decode.html) · [stringify](./json-stringify.html)
