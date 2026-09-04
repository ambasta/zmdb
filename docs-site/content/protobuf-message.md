> **Codec support.** `ProtoField<N>` and `Proto<K>` are carried through the
> shared TypeIR, and `protoDescriptor<T>()` emits a parser-valid proto3 descriptor
> at build time. AOT [encode](./protobuf-encode.html) and
> [decode](./protobuf-decode.html) are emitted from that same checked IR.

## Declare the wire contract once

```ts
import { protoDescriptor } from '@zmdb/aot-validator';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

type State = 'active' | 'paused';

interface UserMessage {
  id: number & Proto<'int32'> & ProtoField<1>;
  name: string & ProtoField<2>;
  state: State & ProtoField<3>;
  seenAt?: Date & ProtoField<4>;
}

export const userProto = protoDescriptor<UserMessage>();
```

The build transform replaces that call with proto3 text. Fields are ordered by
number, string unions become enums with a generated zero member, nested objects
become messages, arrays become `repeated`, optional or nullable singular fields
become `optional`, and `Date` imports `google.protobuf.Timestamp`.

Every property needs a unique `ProtoField<N>` in `1 … 536870911`, excluding the
reserved `19000 … 19999` range. Missing, duplicate, out-of-range and reserved
numbers are build diagnostics naming the message and property.

## What you would use it for, and what to use instead

**Compact outbound wire format for internal service calls.** Use
`protoEncode<T>(value)` for bytes compiled from the same declaration as the
descriptor, and `protoDecode<T>(bytes)` for the matching inbound TypeScript
shape.

**A schema contract between services in different languages.** Emit
`protoDescriptor<T>()` during the build and feed the resulting `.proto` text to
the other language's ordinary protobuf generator. OpenAPI and JSON Schema remain
the alternatives for JSON APIs.

**gRPC.** The message codec is available, but transport integration remains
separate — see [gRPC](./web-microservices-grpc.html).

## Using a protobuf library alongside zmdb

Nothing prevents it. Generate the `.proto` from the TypeScript declaration first,
then let the protobuf library compile or load that descriptor:

```ts
await writeFile('user.proto', protoDescriptor<UserMessage>());
```

The descriptor removes the second hand-written schema. Another protobuf library
can still own either wire direction when an application needs features outside
the supported mapping; validate its plain result at that boundary:

```ts
import { is } from '@zmdb/aot-validator/utilities';

it('proto message satisfies the entity type', () => {
  const decoded = UserMessage.decode(UserMessage.encode(fixture).finish());
  expect(is<Entity<User>>(toPlain(decoded))).toBe(true);
});
```

The generated validator is still doing real work here: protobuf libraries differ
in how they represent 64-bit integers and timestamps, and the application adapter
has to return the TypeScript shape it declared.

Some source shapes are deliberately refused rather than left undecided:
`Record<string, V>` is invisible to the current reflector, nested arrays have no
direct proto3 spelling, optional-nullable fields have three source states but two
wire states, and discriminated unions cannot become `oneof` until union arms have
a field-number tag slot. Required singular-message cycles have no finite absent
value and are refused. Unknown fields are discarded, so decode/re-encode is not
safe for a proxy.

---

See also: [stringify](./json-stringify.html) · [parse](./json-parse.html) · [gRPC](./web-microservices-grpc.html)
