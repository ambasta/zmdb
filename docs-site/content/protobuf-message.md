> **ToDo / feature gap.** There is no protobuf support. No `.proto` emitter, no
> wire-format encoder or decoder, and no descriptor mapping. The functions on the
> other two pages — [encode](./protobuf-encode.html),
> [decode](./protobuf-decode.html) — do not exist either.

## What you would use it for, and what to use instead

**Compact wire format for internal service calls.** Today: JSON via [`stringify`](./json-stringify.html) / [`parse`](./json-parse.html), which is generated per-type and fast, but larger on the wire than protobuf and slower to parse for numeric-heavy payloads.

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
  expect(is<Entity<typeof users>>(toPlain(decoded))).toBe(true);
});
```

The generated validator is doing real work here: it is the only thing that notices when someone adds a field to the `.proto` and not to the schema, or changes an `int64` that arrives as a `Long` rather than a `number`.

## What it would take

Three separable pieces, in increasing difficulty:

1. **A `.proto` emitter** from a `TypeDescriptor` — mechanically similar to `toJsonSchema`, which already walks the same descriptors. This is the easy part and would be genuinely useful on its own for teams whose contract lives in protobuf.
2. **An encoder and decoder** generated per type by the transformer, the same way `stringify` is. Varint and length-delimited framing are not hard; the work is in the volume of cases.
3. **The type mapping**, which is where the design questions are. Protobuf's `int64` does not fit a JS `number` — the same problem as [bigint columns](./bigint-keys.html). `optional` versus proto3 field presence does not line up cleanly with `T | undefined`. `oneof` maps to a discriminated union only if you pick a tag convention. `map<K,V>` and `repeated` need decisions about `Record` versus `Map`.

None of it is blocked; all of it is a substantial amount of surface for a feature nobody has asked for with a concrete use case. If you have one, that is the thing that would move it.

---

See also: [stringify](./json-stringify.html) · [parse](./json-parse.html) · [gRPC](./web-microservices-grpc.html)
