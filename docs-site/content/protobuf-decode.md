> **ToDo / feature gap.** There is no protobuf decoder. See
> [Protobuf Messages](./protobuf-message.html) for the whole gap and what
> implementing it would involve.

## The nearest thing that exists

`parse<T>()` and `decode<T>()` are the generated inbound path, and they already have the shape a protobuf decoder would need — validate while decoding, return a result rather than throwing:

```ts
import { parse, decode } from '@zmdb/aot-validator/serialization';

const fromText = parse<User>(await readBody()); // JSON text -> result
const fromValue = decode<User>(alreadyParsed); // parsed value -> result
```

Both return `{ success: true, data }` or `{ success: false, errors }`, which is the right shape at a boundary: a malformed message from a peer is an expected outcome, not an exception.

## Decoding protobuf today

Use a library for the wire format and validate the result, which is where the two type systems meet:

```ts
import { validate } from '@zmdb/aot-validator/utilities';

export function decodeUser(bytes: Uint8Array) {
  const message = UserMessage.decode(bytes);
  return validate<User>(toPlain(message));
}
```

Do not skip the `validate`. A protobuf decode succeeds on far more inputs than you expect: every field is optional on the wire in proto3, so a message missing a field you require decodes cleanly into a zero value. `0` and `''` arriving where you expected a real value is the characteristic protobuf bug, and a total check against the TypeScript type is what catches it.

> [!WARNING]
> `int64` fields commonly decode to a `Long` or a `bigint`, not a `number`.
> Validating against a `number`-typed field will fail — correctly. Normalise in
> `toPlain`, and decide there what happens above `Number.MAX_SAFE_INTEGER`. Same
> problem as [bigint columns](./bigint-keys.html).

## What it would take

The decoder is generated the same way `parse` is, from the same descriptor walk. Wire parsing is straightforward; unknown-field preservation and the [field-presence mapping](./protobuf-message.html) are the parts that need a decision, and they are shared with the encoder.

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Encode](./protobuf-encode.html) · [parse](./json-parse.html)
