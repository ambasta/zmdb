> **ToDo / feature gap.** There is no protobuf support. No `.proto` emitter, no
> wire-format encoder or decoder, and no descriptor mapping. The functions on the
> other two pages — [encode](./protobuf-encode.html),
> [decode](./protobuf-decode.html) — do not exist either.

## What you would use it for, and what to use instead

**Compact wire format for internal service calls.** Today: JSON via
[`stringify`](./json-stringify.html) / [`parse`](./json-parse.html).
`stringify` currently follows the runtime `JSON.stringify` path and `parse`
follows `JSON.parse`; neither supplies a binary schema contract.

**A schema contract between services in different languages.** Today: [OpenAPI](./openapi.html) from `toOpenApi`, or JSON Schema from `toJsonSchema`. Both are generated from the same TypeScript types, and both have code generators for most languages. This covers the contract need; it does not give you the binary format.

**gRPC.** Not available at all — see [gRPC](./web-microservices-grpc.html), which is blocked on this page.

## Using a protobuf library alongside zmdb

Nothing prevents it; the cost is that the message shape is declared twice.

```ts
// user.proto is the source of truth for the wire format
// schema.ts is the source of truth for the database
```

If you go this way, add a test that pins the two together, because nothing else will:

```ts
import { is } from '@zmdb/aot-validator/utilities';

it('proto message satisfies the entity type', () => {
  const decoded = UserMessage.decode(UserMessage.encode(fixture).finish());
  expect(is<Entity<User>>(toPlain(decoded))).toBe(true);
});
```

The generated validator is doing real work here: it is the only thing that notices when someone adds a field to the `.proto` and not to the schema, or changes an `int64` that arrives as a `Long` rather than a `number`.

## What it would take

The mapping is frozen, and implementation is split into three pieces:

1. **IR carriage and a `.proto` emitter.** Every message property has
   `ProtoField<N>`; an untagged `number` is `double`, integer widths use
   `Proto<K>`, 64-bit integers are `bigint`, and `Date` maps to
   `google.protobuf.Timestamp`.
2. **An encoder** generated from that same IR, including proto3 zero omission,
   packed scalar arrays and exact-width integer handling.
3. **A decoder** over the same mapping, including bounded malformed-input
   handling and the declared unknown-field policy.

Some source shapes are deliberately refused rather than left undecided:
`Record<string, V>` is invisible to the current reflector, nested arrays have no
direct proto3 spelling, optional-nullable fields have three source states but two
wire states, and discriminated unions cannot become `oneof` until union arms have
a field-number tag slot. Unknown fields are discarded, so decode/re-encode is not
safe for a proxy.

---

See also: [stringify](./json-stringify.html) · [parse](./json-parse.html) · [gRPC](./web-microservices-grpc.html)
