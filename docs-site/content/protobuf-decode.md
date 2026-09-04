> **ToDo / feature gap.** There is no protobuf decoder. See
> [Protobuf Messages](./protobuf-message.html) for the descriptor surface that
> exists and the remaining codec gap.

## The nearest thing that exists

`parse<T>()` and `decode<T>()` are the current JSON-text inbound path. Both take
a string; `decode` additionally accepts a runtime `TypeIR` witness:

```ts
import { parse, decode } from '@zmdb/aot-validator/serialization';
import type { TypeIR } from '@zmdb/schema-core/ir';

function decodeUser(text: string, userIr: TypeIR) {
  const parsed = parse<User>(text); // JSON text -> unvalidated result
  const checked = decode<User>(text, userIr); // JSON text -> checked result
  return { parsed, checked };
}
```

Both return `{ success: true, data }` or `{ success: false, issues }`. `parse<T>`
is an unvalidated type claim; `decode<T>` parses and then checks against its
runtime witness.

## Decoding protobuf today

Use a library for the wire format and validate the result, which is where the two type systems meet:

```ts
import { validate } from '@zmdb/aot-validator/utilities';

export function decodeUser(bytes: Uint8Array) {
  const message = UserMessage.decode(bytes);
  return validate<User>(toPlain(message));
}
```

Do not mistake structural validation for presence validation. Proto3 cannot
distinguish an absent implicit-presence scalar from its zero value, and an
unconstrained `number`, `string` or `boolean` accepts that zero. Use an optional
field when presence itself matters; a semantic constraint may reject a zero, but
the plain TypeScript shape cannot prove the field was on the wire.

> [!WARNING]
> `int64` fields commonly decode to a `Long` or a `bigint`, not a `number`.
> Validating against a `number`-typed field will fail — correctly. Normalise in
> `toPlain`, and decide there what happens above `Number.MAX_SAFE_INTEGER`. Same
> problem as [bigint columns](./bigint-keys.html).

## What it would take

The presence mapping and unknown-field behavior are frozen. Optional and
required-nullable fields use explicit presence; optional-nullable fields are
refused. Unknown fields are skipped by wire type and discarded, so
decode-then-re-encode loses them. The remaining decoder work is implementation:
bounds-check lengths against the remaining input, reject mid-field truncation
with an offset/reason, accept alternate valid packed/unpacked forms, and refuse
deprecated groups.

---

See also: [Protobuf Messages](./protobuf-message.html) · [Protobuf Encode](./protobuf-encode.html) · [parse](./json-parse.html)
